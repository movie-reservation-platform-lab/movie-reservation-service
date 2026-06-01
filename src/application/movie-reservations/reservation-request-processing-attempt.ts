import type { ReservationId } from '../../domain/movie-reservations/reservation-id';
import type { ReservationRequestId } from '../../domain/movie-reservations/reservation-request-id';
import type { ReservationRequestSequence } from '../../domain/movie-reservations/reservation-request-sequence';

/**
 * Fields recorded for every processor attempt, regardless of outcome.
 */
interface ReservationRequestProcessingAttemptBase {
  readonly reservationRequestId: ReservationRequestId;
  readonly sequence: ReservationRequestSequence;
  readonly startedAt: string;
  readonly completedAt: string;
}

/**
 * Internal processing attempt for debugging and operational visibility.
 *
 * Useful for application owners investigating FIFO ordering, stuck work,
 * or processor failures.
 *
 * This is modeled as a discriminated union so `outcome` determines which
 * outcome-specific fields must exist. A confirmed attempt must point at the
 * created reservation, a rejected attempt must point at the conflicting
 * reservation, and a failed attempt must carry the internal failure reason.
 */
export type ReservationRequestProcessingAttempt =
  | ConfirmedReservationRequestProcessingAttempt
  | RejectedReservationRequestProcessingAttempt
  | FailedReservationRequestProcessingAttempt;

/**
 * Attempt record for a request that produced a confirmed reservation.
 */
export interface ConfirmedReservationRequestProcessingAttempt extends ReservationRequestProcessingAttemptBase {
  readonly outcome: 'confirmed';
  readonly reservationId: ReservationId;
}

/**
 * Attempt record for an all-or-nothing rejection caused by a seat conflict.
 */
export interface RejectedReservationRequestProcessingAttempt extends ReservationRequestProcessingAttemptBase {
  readonly outcome: 'rejected';
  readonly reason: 'seat-conflict';
  readonly conflictingReservationId: ReservationId;
}

/**
 * Attempt record for an internal failure after work was claimed or abandoned.
 *
 * `unexpected-error` is the current transient bucket for processor
 * exceptions. `lease-timeout` records the worker ownership path: a worker claimed
 * the request, stopped heartbeating, and the request exceeded its reclaim budget.
 * A later durable worker should replace the coarse `unexpected-error` bucket
 * with explicit retryable and non-retryable classifications.
 */
export interface FailedReservationRequestProcessingAttempt extends ReservationRequestProcessingAttemptBase {
  readonly outcome: 'failed';
  readonly reason: 'unexpected-error' | 'lease-timeout';
}
