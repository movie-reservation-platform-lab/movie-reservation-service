import { createReservation } from '../../domain/movie-reservations/reservation';
import type { ClaimedReservationRequest } from './claimed-reservation-request';
import type { Clock } from './ports/clock';
import type { ReservationIdGenerator } from './ports/reservation-id-generator';
import type {
  ReservationRequestProcessor,
  ReservationRequestProcessingResult,
} from './ports/reservation-request-processor';
import type { ReservationRequestWorkRepository } from './ports/reservation-request-work-repository';
import type {
  ConfirmedReservationRequestProcessingAttempt,
  FailedReservationRequestProcessingAttempt,
  RejectedReservationRequestProcessingAttempt,
} from './reservation-request-processing-attempt';

/**
 * Application processor that runs reservation request work inside the current
 * service process.
 *
 * "In-process" means no external worker runtime, queue consumer, or background
 * daemon owns this workflow yet. The class still stays in the application layer
 * because it orchestrates domain rules through ports; infrastructure supplies
 * the concrete repository, clock, and id generator.
 *
 * TODO(D5 follow-up): terminal state transitions and attempt recording are not
 *  transactional yet. A durable worker should make confirm/reject/fail plus
 *  attempt history atomic, or use an outbox/observability pipeline so a
 *  terminal request is not later misclassified because history recording failed.
 */
export class InProcessReservationRequestProcessor implements ReservationRequestProcessor {
  constructor(
    private readonly workRepository: ReservationRequestWorkRepository,
    private readonly reservationIdGenerator: ReservationIdGenerator,
    private readonly clock: Clock,
  ) {}

  async processNextPendingRequest(): Promise<ReservationRequestProcessingResult> {
    const claimedWorkItem =
      await this.workRepository.claimNextPendingReservationRequest();

    if (claimedWorkItem === null) {
      return { outcome: 'no-pending-request' };
    }

    const startedAt = this.clock.nowIsoString();
    let terminalStatePersisted = false;

    try {
      const conflict =
        await this.workRepository.findConflictingConfirmedReservation({
          screeningId: claimedWorkItem.reservationRequest.screeningId,
          seatIds: claimedWorkItem.reservationRequest.seatIds,
        });

      if (conflict !== null) {
        const reservationRequest =
          await this.workRepository.rejectClaimedReservationRequest({
            claimedWorkItem,
            reason: 'seat-conflict',
          });
        terminalStatePersisted = true;
        const attempt: RejectedReservationRequestProcessingAttempt = {
          reservationRequestId: reservationRequest.id,
          sequence: claimedWorkItem.sequence,
          startedAt,
          completedAt: this.clock.nowIsoString(),
          outcome: 'rejected',
          reason: 'seat-conflict',
          conflictingReservationId: conflict.id,
        };

        await this.workRepository.recordReservationRequestProcessingAttempt(
          attempt,
        );

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
      const reservationRequest =
        await this.workRepository.confirmClaimedReservationRequest({
          claimedWorkItem,
          reservation,
        });
      terminalStatePersisted = true;
      const attempt: ConfirmedReservationRequestProcessingAttempt = {
        reservationRequestId: reservationRequest.id,
        sequence: claimedWorkItem.sequence,
        startedAt,
        completedAt: this.clock.nowIsoString(),
        outcome: 'confirmed',
        reservationId: reservation.id,
      };

      await this.workRepository.recordReservationRequestProcessingAttempt(
        attempt,
      );

      return {
        outcome: 'confirmed',
        attempt,
        reservationRequest,
        reservation,
      };
    } catch (error) {
      if (terminalStatePersisted) {
        throw error;
      }

      return this.failClaimedRequest(claimedWorkItem, startedAt);
    }
  }

  /**
   * Records a terminal FAILED outcome after processing a claimed request aborts
   * before CONFIRMED or REJECTED state was persisted.
   */
  private async failClaimedRequest(
    claimedWorkItem: ClaimedReservationRequest,
    startedAt: string,
  ): Promise<ReservationRequestProcessingResult> {
    const reservationRequest =
      await this.workRepository.failClaimedReservationRequest({
        claimedWorkItem,
        reason: 'unexpected-error',
      });
    const attempt: FailedReservationRequestProcessingAttempt = {
      reservationRequestId: reservationRequest.id,
      sequence: claimedWorkItem.sequence,
      startedAt,
      completedAt: this.clock.nowIsoString(),
      outcome: 'failed',
      reason: 'unexpected-error',
    };

    await this.workRepository.recordReservationRequestProcessingAttempt(
      attempt,
    );

    return {
      outcome: 'failed',
      attempt,
      reservationRequest,
      reason: 'unexpected-error',
    };
  }
}
