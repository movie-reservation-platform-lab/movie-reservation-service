import { randomUUID } from 'node:crypto';

import { createReservation } from '../../domain/movie-reservations/reservation';
import type { ClaimedReservationRequest } from './claimed-reservation-request';
import type { Clock } from './ports/clock';
import type { ReservationIdGenerator } from './ports/reservation-id-generator';
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
  ) {}

  async processNextPendingRequest(
    input: ReservationRequestProcessingInput = {},
  ): Promise<ReservationRequestProcessingResult> {
    const startedAt = this.clock.nowIsoString();
    const claimedWorkItem =
      await this.workRepository.claimNextPendingReservationRequest({
        workerId: this.options.workerId,
        claimToken:
          input.claimToken ?? this.options.createClaimToken?.() ?? randomUUID(),
        claimedAt: startedAt,
        claimExpiresAt: addMilliseconds(startedAt, this.options.claimLeaseMs),
        maxLeaseTimeouts: this.options.maxLeaseTimeouts,
        maxTransientFailures: this.options.maxTransientFailures,
      });

    if (claimedWorkItem === null) {
      return { outcome: 'no-pending-request' };
    }

    input.onClaimed?.(claimedWorkItem);
    let terminalStatePersisted = false;

    try {
      const conflict =
        await this.workRepository.findConflictingConfirmedReservation({
          screeningId: claimedWorkItem.reservationRequest.screeningId,
          seatIds: claimedWorkItem.reservationRequest.seatIds,
        });

      if (conflict !== null) {
        const attempt: RejectedReservationRequestProcessingAttempt = {
          reservationRequestId: claimedWorkItem.reservationRequest.id,
          sequence: claimedWorkItem.sequence,
          startedAt,
          completedAt: this.clock.nowIsoString(),
          outcome: 'rejected',
          reason: 'seat-conflict',
          conflictingReservationId: conflict.id,
        };
        const reservationRequest =
          await this.workRepository.rejectClaimedReservationRequest({
            claimedWorkItem,
            reason: 'seat-conflict',
            attempt,
          });
        terminalStatePersisted = true;

        return {
          outcome: 'rejected',
          attempt,
          reservationRequest,
          reason: 'seat-conflict',
        };
      }

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
      const confirmResult =
        await this.workRepository.confirmClaimedReservationRequest({
          claimedWorkItem,
          reservation,
          attempt,
        });
      terminalStatePersisted = true;

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
    } catch (error) {
      if (terminalStatePersisted) {
        throw error;
      }

      return this.handleUnexpectedFailure(claimedWorkItem, startedAt);
    }
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
  ): Promise<ReservationRequestProcessingResult> {
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
      const reservationRequest =
        await this.workRepository.releaseClaimedReservationRequestForRetry({
          claimedWorkItem,
          reason: 'unexpected-error',
          attempt,
        });

      return {
        outcome: 'retryable-failure',
        attempt,
        reservationRequest,
        reason: 'unexpected-error',
        attemptsRemaining:
          this.options.maxTransientFailures - nextTransientFailureCount,
      };
    }

    const reservationRequest =
      await this.workRepository.failClaimedReservationRequest({
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
}

function addMilliseconds(isoString: string, milliseconds: number): string {
  return new Date(new Date(isoString).getTime() + milliseconds).toISOString();
}
