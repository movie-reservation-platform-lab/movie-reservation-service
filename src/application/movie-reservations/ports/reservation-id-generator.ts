import type { ReservationId } from '../../../domain/movie-reservations/reservation-id';

export interface ReservationIdGenerator {
  generateReservationId(): ReservationId;
}
