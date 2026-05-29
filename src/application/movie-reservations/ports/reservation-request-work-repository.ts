import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { SeatId } from '../../../domain/movie-reservations/seat-id';
import type { ClaimedReservationRequest } from '../claimed-reservation-request';
import type { ReservationRequestProcessingAttempt } from '../reservation-request-processing-attempt';

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
   * for example by selecting the lowest-sequence REQUESTED row under a lock and
   * returning the updated PROCESSING row.
   */
  claimNextPendingReservationRequest(): Promise<ClaimedReservationRequest | null>;

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
  }): Promise<ReservationRequest>;

  /**
   * Marks a claimed request REJECTED after a seat conflict.
   */
  rejectClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'seat-conflict';
  }): Promise<ReservationRequest>;

  /**
   * Marks a claimed request FAILED after an unexpected processor failure.
   *
   * Currently FAILED is treated as terminal. Future durable worker phases should decide
   * retry, lease-expiry, and dead-letter behavior around this operation.
   */
  failClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
  }): Promise<ReservationRequest>;

  /**
   * Records internal operational history for application owners.
   */
  recordReservationRequestProcessingAttempt(
    attempt: ReservationRequestProcessingAttempt,
  ): Promise<void>;

  /**
   * Reads internal processing history for tests and future observability.
   */
  findReservationRequestProcessingAttemptsByRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<readonly ReservationRequestProcessingAttempt[]>;
}
