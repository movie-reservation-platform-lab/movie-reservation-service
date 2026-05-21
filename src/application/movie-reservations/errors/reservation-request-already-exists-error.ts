import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';

/**
 * Raised when persistence is asked to create a reservation request with an id
 * that already exists.
 */
export class ReservationRequestAlreadyExistsError extends Error {
  constructor(reservationRequestId: ReservationRequestId) {
    super(`Reservation request ${reservationRequestId} already exists`);
    this.name = 'ReservationRequestAlreadyExistsError';
  }
}
