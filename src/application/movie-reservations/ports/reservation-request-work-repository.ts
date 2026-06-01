import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { SeatId } from '../../../domain/movie-reservations/seat-id';
import type { ClaimedReservationRequest } from '../claimed-reservation-request';
import type {
  ConfirmedReservationRequestProcessingAttempt,
  FailedReservationRequestProcessingAttempt,
  RejectedReservationRequestProcessingAttempt,
  ReservationRequestProcessingAttempt,
} from '../reservation-request-processing-attempt';

export type ConfirmClaimedReservationRequestResult =
  | {
      readonly outcome: 'confirmed';
      readonly reservationRequest: ReservationRequest;
    }
  | {
      readonly outcome: 'rejected';
      readonly reservationRequest: ReservationRequest;
      readonly attempt: RejectedReservationRequestProcessingAttempt;
    };

export interface ClaimNextPendingReservationRequestInput {
  readonly workerId: string;
  readonly claimToken: string;
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
  readonly maxLeaseTimeouts: number;
  readonly maxTransientFailures: number;
}

export interface HeartbeatClaimedReservationRequestInput {
  readonly claimedWorkItem: ClaimedReservationRequest;
  readonly heartbeatAt: string;
  readonly claimExpiresAt: string;
}

/**
 * Worker-facing persistence boundary for reservation request processing.
 *
 * These methods are intentionally named as workflow operations rather than
 * generic setters. A future durable adapter should map claim/confirm/reject/fail
 * to transactional database operations so the processor does not have to know
 * how rows are locked, updated, or written atomically.
 */
export interface ReservationRequestWorkRepository {
  /**
   * Claims the oldest pending reservation request and moves it to PROCESSING.
   *
   * Durable implementations should perform the claim as one atomic operation,
   * for example by selecting the lowest-sequence eligible REQUESTED or expired
   * PROCESSING row under a lock and returning the updated PROCESSING row.
   */
  claimNextPendingReservationRequest(
    input: ClaimNextPendingReservationRequestInput,
  ): Promise<ClaimedReservationRequest | null>;

  /**
   * Renews an owned claim while the fake worker is still processing it.
   *
   * Returns false when the row is terminal, expired and reclaimed by someone
   * else, or otherwise no longer owned by the supplied claim token.
   */
  heartbeatClaimedReservationRequest(
    input: HeartbeatClaimedReservationRequestInput,
  ): Promise<boolean>;

  /**
   * Finds an already-confirmed reservation that overlaps the requested seats
   * for the same screening.
   */
  findConflictingConfirmedReservation(input: {
    readonly screeningId: ScreeningId;
    readonly seatIds: readonly SeatId[];
  }): Promise<Reservation | null>;

  /**
   * Saves the confirmed reservation and marks the claimed request CONFIRMED.
   *
   * Durable implementations should make both writes part of the same
   * transaction and enforce double-booking protection at the database layer.
   */
  confirmClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reservation: Reservation;
    readonly attempt: ConfirmedReservationRequestProcessingAttempt;
  }): Promise<ConfirmClaimedReservationRequestResult>;

  /**
   * Marks a claimed request REJECTED after a seat conflict.
   */
  rejectClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'seat-conflict';
    readonly attempt: RejectedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest>;

  /**
   * Records an unexpected processor failure and releases the request for a
   * later retry while attempts remain.
   */
  releaseClaimedReservationRequestForRetry(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest>;

  /**
   * Marks a claimed request FAILED after an unexpected processor failure uses
   * the final configured attempt.
   *
   * Future durable worker phases should decide retry classification,
   * backoff/jitter, and dead-letter behavior around this operation.
   */
  failClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest>;

  /**
   * Reads internal processing history for tests and future observability.
   */
  findReservationRequestProcessingAttemptsByRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<readonly ReservationRequestProcessingAttempt[]>;
}
