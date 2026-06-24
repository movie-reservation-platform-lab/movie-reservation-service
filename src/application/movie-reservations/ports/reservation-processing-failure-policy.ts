import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';

export interface ReservationProcessingFailurePolicyInput {
  readonly reservationRequestId: ReservationRequestId;
}

/**
 * Application port for temporary processor failure simulation.
 *
 * The application layer owns where the decision is applied. Infrastructure can
 * supply the concrete decision algorithm, such as a salted stable hash.
 */
export interface ReservationProcessingFailurePolicy {
  shouldFailReservationProcessing(input: ReservationProcessingFailurePolicyInput): boolean;
}
