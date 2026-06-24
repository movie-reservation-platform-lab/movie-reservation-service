import { randomUUID } from 'node:crypto';

import { createReservation } from '../../domain/movie-reservations/reservation';
import type { ReservationId } from '../../domain/movie-reservations/reservation-id';
import type { ClaimedReservationRequest } from './claimed-reservation-request';
import { DisabledReservationProcessingFailurePolicy } from './disabled-reservation-processing-failure-policy';
import { SeatReservationCommitError } from './errors/seat-reservation-commit-error';
import { NoopMovieReservationObservability } from './noop-movie-reservation-observability';
import type { Clock } from './ports/clock';
import type {
  MovieReservationObservability,
  ReservationProcessorSpanAttributes,
} from './ports/movie-reservation-observability';
import type { ReservationIdGenerator } from './ports/reservation-id-generator';
import type { ReservationProcessingFailurePolicy } from './ports/reservation-processing-failure-policy';
import type {
  ReservationRequestProcessor,
  ReservationRequestProcessingInput,
  ReservationRequestProcessingResult,
} from './ports/reservation-request-processor';
import type { ReservationRequestWorkRepository } from './ports/reservation-request-work-repository';
import type {
  ConfirmedReservationRequestProcessingAttempt,
  FailedReservationRequestProcessingAttempt,
  RejectedReservationRequestProcessingAttempt,
} from './reservation-request-processing-attempt';

export interface InProcessReservationRequestProcessorOptions {
  readonly workerId: string;
  readonly claimLeaseMs: number;
  readonly maxLeaseTimeouts: number;
  readonly maxTransientFailures: number;
  readonly createClaimToken?: () => string;
}

type UnexpectedFailureProcessingResult = Extract<
  ReservationRequestProcessingResult,
  { readonly outcome: 'retryable-failure' | 'failed' }
>;

type TerminalProcessingResult = Extract<
  ReservationRequestProcessingResult,
  { readonly outcome: 'confirmed' | 'rejected' }
>;

type RejectedProcessingResult = Extract<ReservationRequestProcessingResult, { readonly outcome: 'rejected' }>;

type ProcessedWorkItemResult = Extract<
  ReservationRequestProcessingResult,
  { readonly outcome: 'confirmed' | 'rejected' | 'retryable-failure' | 'failed' }
>;

interface ClaimedWorkItemProcessingInput {
  readonly claimedWorkItem: ClaimedReservationRequest;
  readonly processorInput: ReservationRequestProcessingInput;
  readonly startedAt: string;
  readonly durationStartedAt: bigint;
}

const defaultProcessorOptions: InProcessReservationRequestProcessorOptions = {
  workerId: 'manual-in-process-reservation-processor',
  claimLeaseMs: 30_000,
  maxLeaseTimeouts: 3,
  maxTransientFailures: 3,
  createClaimToken: randomUUID,
};

/**
 * Application processor that runs reservation request work inside the current
 * service process.
 *
 * "In-process" means no external worker runtime, queue consumer, or background
 * daemon owns this workflow yet. The class still stays in the application layer
 * because it orchestrates domain rules through ports; infrastructure supplies
 * the concrete repository, clock, and id generator.
 *
 */
export class InProcessReservationRequestProcessor implements ReservationRequestProcessor {
  constructor(
    private readonly workRepository: ReservationRequestWorkRepository,
    private readonly reservationIdGenerator: ReservationIdGenerator,
    private readonly clock: Clock,
    private readonly options: InProcessReservationRequestProcessorOptions = defaultProcessorOptions,
    private readonly observability: MovieReservationObservability = new NoopMovieReservationObservability(),
    private readonly failurePolicy: ReservationProcessingFailurePolicy = new DisabledReservationProcessingFailurePolicy(),
  ) {}

  async processNextPendingRequest(
    input: ReservationRequestProcessingInput = {},
  ): Promise<ReservationRequestProcessingResult> {
    const durationStartedAt = process.hrtime.bigint();
    const startedAt = this.clock.nowIsoString();
    const claimedWorkItem = await this.workRepository.claimNextPendingReservationRequest({
      workerId: this.options.workerId,
      claimToken: input.claimToken ?? this.options.createClaimToken?.() ?? randomUUID(),
      claimedAt: startedAt,
      claimExpiresAt: addMilliseconds(startedAt, this.options.claimLeaseMs),
      maxLeaseTimeouts: this.options.maxLeaseTimeouts,
      maxTransientFailures: this.options.maxTransientFailures,
    });

    if (claimedWorkItem === null) {
      this.observability.recordReservationProcessorOutcome({
        outcome: 'no-pending-request',
        durationMs: calculateDurationMs(durationStartedAt),
      });
      return { outcome: 'no-pending-request' };
    }

    return this.observability.runWithReservationProcessorSpan(
      this.createReservationProcessorSpanAttributes(claimedWorkItem),
      () =>
        this.processClaimedWorkItem({
          claimedWorkItem,
          processorInput: input,
          startedAt,
          durationStartedAt,
        }),
    );
  }

  /**
   * Runs the claimed request through the application workflow.
   *
   * `terminalStatePersisted` protects completed work from being released for a
   * retry when a later side effect, such as observability, throws after the
   * repository has already persisted CONFIRMED or REJECTED.
   */
  private async processClaimedWorkItem(
    input: ClaimedWorkItemProcessingInput,
  ): Promise<ReservationRequestProcessingResult> {
    const { claimedWorkItem, processorInput, startedAt, durationStartedAt } = input;

    this.recordClaimedWorkItem(claimedWorkItem);
    processorInput.onClaimed?.(claimedWorkItem);

    let terminalStatePersisted = false;

    try {
      const conflict = await this.workRepository.findConflictingConfirmedReservation({
        screeningId: claimedWorkItem.reservationRequest.screeningId,
        seatIds: claimedWorkItem.reservationRequest.seatIds,
      });

      if (conflict !== null) {
        const rejectedResult = await this.rejectClaimedWorkItemForSeatConflict(claimedWorkItem, startedAt, conflict.id);
        terminalStatePersisted = true;
        this.recordProcessorOutcome(rejectedResult, claimedWorkItem, durationStartedAt);

        return rejectedResult;
      }

      this.throwIfFailurePolicyBlocksCommit(claimedWorkItem);

      const terminalResult = await this.confirmClaimedWorkItem(claimedWorkItem, startedAt);
      terminalStatePersisted = true;
      this.recordProcessorOutcome(terminalResult, claimedWorkItem, durationStartedAt);

      return terminalResult;
    } catch (error) {
      if (terminalStatePersisted) {
        this.observability.recordReservationProcessorException(error);
        throw error;
      }

      const failureResult = await this.handleUnexpectedFailure(claimedWorkItem, startedAt);
      this.observability.recordReservationProcessorException(error);
      this.recordProcessorOutcome(failureResult, claimedWorkItem, durationStartedAt);

      return failureResult;
    }
  }

  /**
   * Decides whether to simulate failure for the given request
   *
   * @param claimedWorkItem
   * @private
   */
  private throwIfFailurePolicyBlocksCommit(claimedWorkItem: ClaimedReservationRequest): void {
    if (
      this.failurePolicy.shouldFailReservationProcessing({
        reservationRequestId: claimedWorkItem.reservationRequest.id,
      })
    ) {
      throw new SeatReservationCommitError();
    }
  }

  /**
   * Persists the terminal rejection path for a request that conflicts with an
   * already-confirmed reservation.
   */
  private async rejectClaimedWorkItemForSeatConflict(
    claimedWorkItem: ClaimedReservationRequest,
    startedAt: string,
    conflictingReservationId: ReservationId,
  ): Promise<RejectedProcessingResult> {
    const attempt: RejectedReservationRequestProcessingAttempt = {
      reservationRequestId: claimedWorkItem.reservationRequest.id,
      sequence: claimedWorkItem.sequence,
      startedAt,
      completedAt: this.clock.nowIsoString(),
      outcome: 'rejected',
      reason: 'seat-conflict',
      conflictingReservationId,
    };
    const reservationRequest = await this.workRepository.rejectClaimedReservationRequest({
      claimedWorkItem,
      reason: 'seat-conflict',
      attempt,
    });

    return {
      outcome: 'rejected',
      attempt,
      reservationRequest,
      reason: 'seat-conflict',
    };
  }

  /**
   * Attempts to confirm the claimed request.
   *
   * The repository may still return `rejected` here when a durable adapter
   * detects a concurrent seat conflict during the transactional confirm step.
   */
  private async confirmClaimedWorkItem(
    claimedWorkItem: ClaimedReservationRequest,
    startedAt: string,
  ): Promise<TerminalProcessingResult> {
    const reservation = createReservation({
      id: this.reservationIdGenerator.generateReservationId(),
      movieProviderId: claimedWorkItem.reservationRequest.movieProviderId,
      reservationRequestId: claimedWorkItem.reservationRequest.id,
      screeningId: claimedWorkItem.reservationRequest.screeningId,
      seatIds: claimedWorkItem.reservationRequest.seatIds,
      reservedByUserId: claimedWorkItem.reservationRequest.requestedByUserId,
      confirmedAt: this.clock.nowIsoString(),
    });
    const attempt: ConfirmedReservationRequestProcessingAttempt = {
      reservationRequestId: claimedWorkItem.reservationRequest.id,
      sequence: claimedWorkItem.sequence,
      startedAt,
      completedAt: this.clock.nowIsoString(),
      outcome: 'confirmed',
      reservationId: reservation.id,
    };
    const confirmResult = await this.workRepository.confirmClaimedReservationRequest({
      claimedWorkItem,
      reservation,
      attempt,
    });

    if (confirmResult.outcome === 'rejected') {
      return {
        outcome: 'rejected',
        attempt: confirmResult.attempt,
        reservationRequest: confirmResult.reservationRequest,
        reason: 'seat-conflict',
      };
    }

    return {
      outcome: 'confirmed',
      attempt,
      reservationRequest: confirmResult.reservationRequest,
      reservation,
    };
  }

  /**
   * Records an unexpected internal failure.
   *
   * Seat conflicts stay terminal REJECTED. The current logic
   * treats `unexpected-error` as a coarse transient bucket because all known
   * business failures are handled before this catch block.
   *
   * TODO: Replace this catch-all with explicit retryable/non-retryable
   *  classification before adding real external dependencies such as payment,
   *  provider inventory, or notification calls.
   */
  private async handleUnexpectedFailure(
    claimedWorkItem: ClaimedReservationRequest,
    startedAt: string,
  ): Promise<UnexpectedFailureProcessingResult> {
    const attempt: FailedReservationRequestProcessingAttempt = {
      reservationRequestId: claimedWorkItem.reservationRequest.id,
      sequence: claimedWorkItem.sequence,
      startedAt,
      completedAt: this.clock.nowIsoString(),
      outcome: 'failed',
      reason: 'unexpected-error',
    };

    const nextTransientFailureCount = claimedWorkItem.transientFailureCount + 1;

    if (nextTransientFailureCount < this.options.maxTransientFailures) {
      const reservationRequest = await this.workRepository.releaseClaimedReservationRequestForRetry({
        claimedWorkItem,
        reason: 'unexpected-error',
        attempt,
      });

      return {
        outcome: 'retryable-failure',
        attempt,
        reservationRequest,
        reason: 'unexpected-error',
        attemptsRemaining: this.options.maxTransientFailures - nextTransientFailureCount,
      };
    }

    const reservationRequest = await this.workRepository.failClaimedReservationRequest({
      claimedWorkItem,
      reason: 'unexpected-error',
      attempt,
    });

    return {
      outcome: 'failed',
      attempt,
      reservationRequest,
      reason: 'unexpected-error',
    };
  }

  private recordClaimedWorkItem(claimedWorkItem: ClaimedReservationRequest): void {
    this.observability.recordReservationProcessorClaimed(
      this.createReservationProcessorSpanAttributes(claimedWorkItem),
    );
  }

  /**
   * Emits the shared completion event shape for terminal and unexpected failure
   * outcomes.
   */
  private recordProcessorOutcome(
    result: ProcessedWorkItemResult,
    claimedWorkItem: ClaimedReservationRequest,
    durationStartedAt: bigint,
  ): void {
    const baseAttributes = {
      reservationRequestId: result.reservationRequest.id,
      sequence: claimedWorkItem.sequence,
      durationMs: calculateDurationMs(durationStartedAt),
      ...this.createOptionalObservabilityContextAttributes(claimedWorkItem),
    };

    if (result.outcome === 'confirmed') {
      this.observability.recordReservationProcessorOutcome({
        ...baseAttributes,
        outcome: result.outcome,
      });
      return;
    }

    this.observability.recordReservationProcessorOutcome({
      ...baseAttributes,
      outcome: result.outcome,
      reason: result.reason,
    });
  }

  /**
   * Builds the common processor attributes used by both the span and the
   * claimed-work log event.
   */
  private createReservationProcessorSpanAttributes(
    claimedWorkItem: ClaimedReservationRequest,
  ): ReservationProcessorSpanAttributes {
    return {
      reservationRequestId: claimedWorkItem.reservationRequest.id,
      sequence: claimedWorkItem.sequence,
      ...this.createOptionalObservabilityContextAttributes(claimedWorkItem),
    };
  }

  private createOptionalObservabilityContextAttributes(
    claimedWorkItem: ClaimedReservationRequest,
  ): Pick<ReservationProcessorSpanAttributes, 'observabilityContext'> {
    return claimedWorkItem.observabilityContext === undefined
      ? {}
      : { observabilityContext: claimedWorkItem.observabilityContext };
  }
}

function addMilliseconds(isoString: string, milliseconds: number): string {
  return new Date(new Date(isoString).getTime() + milliseconds).toISOString();
}

function calculateDurationMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
