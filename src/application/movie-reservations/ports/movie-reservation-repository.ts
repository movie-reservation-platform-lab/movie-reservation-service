import type { Movie } from '../../../domain/movie-reservations/movie';
import type { MovieId } from '../../../domain/movie-reservations/movie-id';
import type { MovieProvider } from '../../../domain/movie-reservations/movie-provider';
import type { MovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationId } from '../../../domain/movie-reservations/reservation-id';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import type { Screening } from '../../../domain/movie-reservations/screening';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { Seat } from '../../../domain/movie-reservations/seat';

/**
 * Persistence port for movie reservation use cases.
 *
 * Implementations can be in-memory, SQL, or remote adapters, but application
 * services depend only on this domain-shaped contract.
 */
export interface MovieReservationRepository {
  findMovieProviderById(
    movieProviderId: MovieProviderId,
  ): Promise<MovieProvider | null>;
  findMoviesByProviderId(
    movieProviderId: MovieProviderId,
  ): Promise<readonly Movie[]>;
  findMovieById(
    movieProviderId: MovieProviderId,
    movieId: MovieId,
  ): Promise<Movie | null>;
  findScreeningsByProviderId(
    movieProviderId: MovieProviderId,
  ): Promise<readonly Screening[]>;
  findScreeningForProvider(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<Screening | null>;
  findSeatsByScreeningId(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<readonly Seat[]>;
  findReservationRequestById(
    reservationRequestId: ReservationRequestId,
  ): Promise<ReservationRequest | null>;
  saveReservationRequest(reservationRequest: ReservationRequest): Promise<void>;
  findReservationById(
    reservationId: ReservationId,
  ): Promise<Reservation | null>;
}
