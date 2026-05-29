import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';

/**
 * Generates ids for newly created reservation requests.
 */
export interface ReservationRequestIdGenerator {
  generateReservationRequestId(): ReservationRequestId;
}
