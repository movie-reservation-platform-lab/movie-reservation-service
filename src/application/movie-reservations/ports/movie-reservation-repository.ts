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
import type { SeatId } from '../../../domain/movie-reservations/seat-id';
import type { ReservationWorkObservabilityContext } from './reservation-work-observability-context-provider';

/**
 * Persistence for movie reservations.
 *
 * Focuses on product-facing reservation/catalog persistence:
 * - movies
 * - screenings
 * - seats
 * - reservation requests
 * - confirmed reservations
 *
 * Implementations can be in-memory, SQL, or remote adapters.
 */
export interface MovieReservationRepository {
  /**
   * Finds the movie provider that owns a tenant-scoped catalog.
   */
  findMovieProviderById(movieProviderId: MovieProviderId): Promise<MovieProvider | null>;

  /**
   * Lists movies visible inside one movie provider boundary.
   */
  findMoviesByProviderId(movieProviderId: MovieProviderId): Promise<readonly Movie[]>;

  /**
   * Finds one movie only when it belongs to the requested provider.
   */
  findMovieById(movieProviderId: MovieProviderId, movieId: MovieId): Promise<Movie | null>;

  /**
   * Lists scheduled screenings visible inside one movie provider boundary.
   */
  findScreeningsByProviderId(
    movieProviderId: MovieProviderId,
    input?: { readonly movieId?: MovieId },
  ): Promise<readonly Screening[]>;

  /**
   * Finds one screening only when it belongs to the requested provider.
   */
  findScreeningForProvider(movieProviderId: MovieProviderId, screeningId: ScreeningId): Promise<Screening | null>;

  /**
   * Lists seats for the auditorium used by a provider-owned screening.
   */
  findSeatsByScreeningId(movieProviderId: MovieProviderId, screeningId: ScreeningId): Promise<readonly Seat[]>;

  /**
   * Batch-loads auditorium seats for provider-owned screenings.
   */
  findSeatsByScreeningIds(
    movieProviderId: MovieProviderId,
    screeningIds: readonly ScreeningId[],
  ): Promise<ReadonlyMap<ScreeningId, readonly Seat[]>>;

  /**
   * Finds only the requested seats when they belong to a provider-owned
   * screening's auditorium.
   */
  findSeatsByIdsForScreening(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
    seatIds: readonly SeatId[],
  ): Promise<readonly Seat[]>;

  /**
   * Reads the reservation request status object by id.
   */
  findReservationRequestById(reservationRequestId: ReservationRequestId): Promise<ReservationRequest | null>;

  /**
   * Persists a newly requested reservation request.
   */
  saveReservationRequest(
    reservationRequest: ReservationRequest,
    observabilityContext?: ReservationWorkObservabilityContext,
  ): Promise<void>;

  /**
   * Reads a confirmed reservation by reservation id.
   */
  findReservationById(reservationId: ReservationId): Promise<Reservation | null>;

  /**
   * Reads the confirmed reservation produced by a reservation request.
   */
  findReservationByReservationRequestId(reservationRequestId: ReservationRequestId): Promise<Reservation | null>;
}
