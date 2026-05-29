import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type {
  ConfirmedReservationRequestProcessingAttempt,
  FailedReservationRequestProcessingAttempt,
  RejectedReservationRequestProcessingAttempt,
} from '../reservation-request-processing-attempt';

/**
 * Asynchronous movie reservation requests processor
 *
 * Reservations are created in `REQUESTED` state. A worker, scheduler or
 * deterministic test can call this processor to advance one pending
 * request through the internal workflow.
 */
export interface ReservationRequestProcessor {
  /**
   * Claim and process one pending reservation request, if any exists.
   *
   * Currently, processes only one request per call and does not run a
   * background loop, retry policy, claim lease, queue, or public GraphQL
   * processing mutation. Those runtime concerns can be added later around this
   * small contract.
   */
  processNextPendingRequest(): Promise<ReservationRequestProcessingResult>;
}

/**
 * Outcome of one reservation processing.
 *
 * This discriminated union lets callers handle each result explicitly:
 * Available fields are narrowed after checking `outcome`.
 * For example:
 * - `reservation` exists only for the `confirmed` branch
 * - while `reason` exists only for rejected/failed branches.
 */
export type ReservationRequestProcessingResult =
  | { readonly outcome: 'no-pending-request' }
  | {
      readonly outcome: 'confirmed';
      readonly attempt: ConfirmedReservationRequestProcessingAttempt;
      readonly reservationRequest: ReservationRequest;
      readonly reservation: Reservation;
    }
  | {
      readonly outcome: 'rejected';
      readonly attempt: RejectedReservationRequestProcessingAttempt;
      readonly reservationRequest: ReservationRequest;
      readonly reason: 'seat-conflict';
    }
  | {
      readonly outcome: 'failed';
      readonly attempt: FailedReservationRequestProcessingAttempt;
      readonly reservationRequest: ReservationRequest;
      readonly reason: 'unexpected-error';
    };
