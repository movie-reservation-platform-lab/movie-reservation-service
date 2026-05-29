import type { MovieReservationRepository } from '../../../application/movie-reservations/ports/movie-reservation-repository';
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
import { InMemoryMovieReservationStore } from './in-memory-movie-reservation.store';

/**
 * In-memory persistence adapter for catalog, request, and reservation reads.
 *
 * Work-claiming behavior lives in `InMemoryReservationRequestWorkRepository`;
 * both adapters share the same store so they speak about the same data.
 */
export class InMemoryMovieReservationRepository implements MovieReservationRepository {
  constructor(private readonly store: InMemoryMovieReservationStore) {}

  static withSeedData(): InMemoryMovieReservationRepository {
    return new InMemoryMovieReservationRepository(
      InMemoryMovieReservationStore.withSeedData(),
    );
  }

  async findMovieProviderById(
    movieProviderId: MovieProviderId,
  ): Promise<MovieProvider | null> {
    return this.store.movieProvidersById.get(movieProviderId) ?? null;
  }

  async findMoviesByProviderId(
    movieProviderId: MovieProviderId,
  ): Promise<readonly Movie[]> {
    return Array.from(this.store.moviesById.values()).filter(
      (movie) => movie.movieProviderId === movieProviderId,
    );
  }

  async findMovieById(
    movieProviderId: MovieProviderId,
    movieId: MovieId,
  ): Promise<Movie | null> {
    const movie = this.store.moviesById.get(movieId);

    if (movie === undefined || movie.movieProviderId !== movieProviderId) {
      return null;
    }

    return movie;
  }

  async findScreeningsByProviderId(
    movieProviderId: MovieProviderId,
  ): Promise<readonly Screening[]> {
    return Array.from(this.store.screeningsById.values()).filter(
      (screening) => screening.movieProviderId === movieProviderId,
    );
  }

  async findScreeningForProvider(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<Screening | null> {
    const screening = this.store.screeningsById.get(screeningId);

    if (
      screening === undefined ||
      screening.movieProviderId !== movieProviderId
    ) {
      return null;
    }

    return screening;
  }

  async findSeatsByScreeningId(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<readonly Seat[]> {
    const screening = this.store.screeningsById.get(screeningId);

    if (
      screening === undefined ||
      screening.movieProviderId !== movieProviderId
    ) {
      return [];
    }

    return Array.from(this.store.seatsById.values()).filter(
      (seat) =>
        seat.movieProviderId === movieProviderId &&
        seat.auditoriumId === screening.auditoriumId,
    );
  }

  async findReservationRequestById(
    reservationRequestId: ReservationRequestId,
  ): Promise<ReservationRequest | null> {
    return this.store.reservationRequestsById.get(reservationRequestId) ?? null;
  }

  async saveReservationRequest(
    reservationRequest: ReservationRequest,
  ): Promise<void> {
    this.store.saveReservationRequest(reservationRequest);
  }

  async findReservationById(
    reservationId: ReservationId,
  ): Promise<Reservation | null> {
    return this.store.reservationsById.get(reservationId) ?? null;
  }

  async findReservationByReservationRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<Reservation | null> {
    for (const reservation of this.store.reservationsById.values()) {
      if (reservation.reservationRequestId === reservationRequestId) {
        return reservation;
      }
    }

    return null;
  }
}
