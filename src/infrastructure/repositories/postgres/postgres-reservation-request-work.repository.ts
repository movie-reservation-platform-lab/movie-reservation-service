import type { Knex } from 'knex';

import type { ClaimedReservationRequest } from '../../../application/movie-reservations/claimed-reservation-request';
import type {
  ClaimNextPendingReservationRequestInput,
  ConfirmClaimedReservationRequestResult,
  HeartbeatClaimedReservationRequestInput,
  ReservationRequestWorkRepository,
} from '../../../application/movie-reservations/ports/reservation-request-work-repository';
import type {
  ConfirmedReservationRequestProcessingAttempt,
  FailedReservationRequestProcessingAttempt,
  RejectedReservationRequestProcessingAttempt,
  ReservationRequestProcessingAttempt,
} from '../../../application/movie-reservations/reservation-request-processing-attempt';
import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { SeatId } from '../../../domain/movie-reservations/seat-id';
import { isPostgresUniqueViolation } from './postgres-errors';
import { PostgresReservationRequestClaimer } from './postgres-reservation-request-claimer';
import { PostgresReservationRequestStateStore } from './postgres-reservation-request-state-store';
import { PostgresReservationStore } from './postgres-reservation-store';

interface ConfirmClaimedReservationRequestInput {
  readonly claimedWorkItem: ClaimedReservationRequest;
  readonly reservation: Reservation;
  readonly attempt: ConfirmedReservationRequestProcessingAttempt;
}

/**
 * Postgres implementation of the worker-facing reservation processing port.
 *
 * This class is intentionally a facade over smaller Postgres helpers. It keeps
 * the application-facing workflow contract in one place while the helpers own
 * the lower-level row locking, state updates, audit writes, and reservation row
 * shape details.
 */
export class PostgresReservationRequestWorkRepository implements ReservationRequestWorkRepository {
  private readonly requestClaimer: PostgresReservationRequestClaimer;
  private readonly reservationStore: PostgresReservationStore;
  private readonly requestStateStore: PostgresReservationRequestStateStore;

  constructor(private readonly database: Knex) {
    this.requestStateStore = new PostgresReservationRequestStateStore(database);
    this.requestClaimer = new PostgresReservationRequestClaimer(
      database,
      this.requestStateStore,
    );
    this.reservationStore = new PostgresReservationStore(database);
  }

  claimNextPendingReservationRequest(
    input: ClaimNextPendingReservationRequestInput,
  ): Promise<ClaimedReservationRequest | null> {
    return this.requestClaimer.claimNextPendingReservationRequest(input);
  }

  heartbeatClaimedReservationRequest(
    input: HeartbeatClaimedReservationRequestInput,
  ): Promise<boolean> {
    return this.requestClaimer.heartbeatClaimedReservationRequest(input);
  }

  findConflictingConfirmedReservation(input: {
    readonly screeningId: ScreeningId;
    readonly seatIds: readonly SeatId[];
  }): Promise<Reservation | null> {
    return this.reservationStore.findConflictingConfirmedReservation(input);
  }

  async confirmClaimedReservationRequest(
    input: ConfirmClaimedReservationRequestInput,
  ): Promise<ConfirmClaimedReservationRequestResult> {
    try {
      const reservationRequest = await this.database.transaction(
        async (trx) => {
          await this.requestStateStore.requireClaimedProcessingRequest(
            trx,
            input.claimedWorkItem,
          );
          await this.reservationStore.insertReservation(trx, input.reservation);
          return this.requestStateStore.markClaimedReservationRequestConfirmed({
            trx,
            claimedWorkItem: input.claimedWorkItem,
            attempt: input.attempt,
          });
        },
      );

      return {
        outcome: 'confirmed',
        reservationRequest,
      };
    } catch (error) {
      return this.handleConfirmClaimedReservationRequestError(error, input);
    }
  }

  /**
   * Translates the database double-booking guard into the application-level
   * rejected result when another worker confirmed the same seat first.
   */
  private async handleConfirmClaimedReservationRequestError(
    error: unknown,
    input: ConfirmClaimedReservationRequestInput,
  ): Promise<ConfirmClaimedReservationRequestResult> {
    if (
      !isPostgresUniqueViolation(
        error,
        'reservation_seats_screening_id_seat_id_unique',
      )
    ) {
      throw error;
    }

    const conflict =
      await this.reservationStore.findConflictingConfirmedReservation({
        screeningId: input.reservation.screeningId,
        seatIds: input.reservation.seatIds,
      });

    if (conflict === null) {
      throw error;
    }

    const rejectedAttempt: RejectedReservationRequestProcessingAttempt = {
      reservationRequestId: input.claimedWorkItem.reservationRequest.id,
      sequence: input.claimedWorkItem.sequence,
      startedAt: input.attempt.startedAt,
      completedAt: input.attempt.completedAt,
      outcome: 'rejected',
      reason: 'seat-conflict',
      conflictingReservationId: conflict.id,
    };
    const rejectedRequest =
      await this.requestStateStore.rejectClaimedReservationRequest({
        claimedWorkItem: input.claimedWorkItem,
        reason: 'seat-conflict',
        attempt: rejectedAttempt,
      });

    return {
      outcome: 'rejected',
      reservationRequest: rejectedRequest,
      attempt: rejectedAttempt,
    };
  }

  rejectClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'seat-conflict';
    readonly attempt: RejectedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    return this.requestStateStore.rejectClaimedReservationRequest(input);
  }

  releaseClaimedReservationRequestForRetry(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    return this.requestStateStore.releaseClaimedReservationRequestForRetry(
      input,
    );
  }

  failClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    return this.requestStateStore.failClaimedReservationRequest(input);
  }

  findReservationRequestProcessingAttemptsByRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<readonly ReservationRequestProcessingAttempt[]> {
    return this.requestStateStore.findReservationRequestProcessingAttemptsByRequestId(
      reservationRequestId,
    );
  }
}
