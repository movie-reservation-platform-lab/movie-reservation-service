import type { MovieReservationRepository } from '../../../application/movie-reservations/ports/movie-reservation-repository';
import { createUserId } from '../../../domain/authentication/user-id';
import type { Auditorium } from '../../../domain/movie-reservations/auditorium';
import {
  type AuditoriumId,
  createAuditoriumId,
} from '../../../domain/movie-reservations/auditorium-id';
import type { Movie } from '../../../domain/movie-reservations/movie';
import {
  type MovieId,
  createMovieId,
} from '../../../domain/movie-reservations/movie-id';
import type { MovieProvider } from '../../../domain/movie-reservations/movie-provider';
import {
  type MovieProviderId,
  createMovieProviderId,
} from '../../../domain/movie-reservations/movie-provider-id';
import type { Reservation } from '../../../domain/movie-reservations/reservation';
import {
  type ReservationId,
  createReservationId,
} from '../../../domain/movie-reservations/reservation-id';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import {
  type ReservationRequestId,
  createReservationRequestId,
} from '../../../domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';
import type { Screening } from '../../../domain/movie-reservations/screening';
import {
  type ScreeningId,
  createScreeningId,
} from '../../../domain/movie-reservations/screening-id';
import type { Seat } from '../../../domain/movie-reservations/seat';
import {
  type SeatId,
  createSeatId,
} from '../../../domain/movie-reservations/seat-id';

/**
 * In-memory persistence adapter for local development, tests, and early demos.
 *
 * This class implements the application repository port without becoming the
 * future persistence model. Postgres/Knex can later implement the same port
 * while application services continue depending on the domain-shaped contract.
 */
export class InMemoryMovieReservationRepository implements MovieReservationRepository {
  private readonly movieProvidersById = new Map<
    MovieProviderId,
    MovieProvider
  >();
  private readonly auditoriumsById = new Map<AuditoriumId, Auditorium>();
  private readonly moviesById = new Map<MovieId, Movie>();
  private readonly screeningsById = new Map<ScreeningId, Screening>();
  private readonly seatsById = new Map<SeatId, Seat>();
  private readonly reservationRequestsById = new Map<
    ReservationRequestId,
    ReservationRequest
  >();
  private readonly reservationsById = new Map<ReservationId, Reservation>();

  constructor(input: {
    readonly movieProviders: readonly MovieProvider[];
    readonly auditoriums: readonly Auditorium[];
    readonly movies: readonly Movie[];
    readonly screenings: readonly Screening[];
    readonly seats: readonly Seat[];
    readonly reservationRequests: readonly ReservationRequest[];
    readonly reservations: readonly Reservation[];
  }) {
    for (const movieProvider of input.movieProviders) {
      this.movieProvidersById.set(movieProvider.id, movieProvider);
    }

    for (const auditorium of input.auditoriums) {
      this.auditoriumsById.set(auditorium.id, auditorium);
    }

    for (const movie of input.movies) {
      this.moviesById.set(movie.id, movie);
    }

    for (const screening of input.screenings) {
      this.screeningsById.set(screening.id, screening);
    }

    for (const seat of input.seats) {
      this.seatsById.set(seat.id, seat);
    }

    for (const reservationRequest of input.reservationRequests) {
      this.reservationRequestsById.set(
        reservationRequest.id,
        reservationRequest,
      );
    }

    for (const reservation of input.reservations) {
      this.reservationsById.set(reservation.id, reservation);
    }
  }

  /**
   * Creates deterministic multi-provider seed data.
   *
   * Keeping at least two providers in the seed set makes tenant/provider
   * isolation visible in tests instead of only exercising single-tenant happy
   * paths.
   */
  static withSeedData(): InMemoryMovieReservationRepository {
    const providerAurora = createMovieProviderId('provider-aurora');
    const providerRiverton = createMovieProviderId('provider-riverton');
    const auditoriumAuroraMain = createAuditoriumId('auditorium-aurora-main');
    const auditoriumRivertonOne = createAuditoriumId('auditorium-riverton-1');
    const screeningAuroraOne = createScreeningId('screening-aurora-1');
    const screeningAuroraTwo = createScreeningId('screening-aurora-2');
    const screeningRivertonOne = createScreeningId('screening-riverton-1');

    return new InMemoryMovieReservationRepository({
      movieProviders: [
        { id: providerAurora, name: 'Aurora Cinema Group' },
        { id: providerRiverton, name: 'Riverton Picture House' },
      ],
      auditoriums: [
        {
          id: auditoriumAuroraMain,
          movieProviderId: providerAurora,
          name: 'Aurora Main Hall',
        },
        {
          id: auditoriumRivertonOne,
          movieProviderId: providerRiverton,
          name: 'Riverton Screen 1',
        },
      ],
      movies: [
        {
          id: createMovieId('movie-aurora-1'),
          movieProviderId: providerAurora,
          title: 'The Type-Safe Matinee',
          rating: 'PG',
          durationMinutes: 102,
        },
        {
          id: createMovieId('movie-aurora-2'),
          movieProviderId: providerAurora,
          title: 'Fargate at Midnight',
          rating: 'PG-13',
          durationMinutes: 118,
        },
        {
          id: createMovieId('movie-riverton-1'),
          movieProviderId: providerRiverton,
          title: 'The Last Deployment',
          rating: 'PG',
          durationMinutes: 96,
        },
      ],
      screenings: [
        {
          id: screeningAuroraOne,
          movieProviderId: providerAurora,
          movieId: createMovieId('movie-aurora-1'),
          auditoriumId: auditoriumAuroraMain,
          startsAt: '2026-06-01T09:00:00.000Z',
          endsAt: '2026-06-01T10:42:00.000Z',
        },
        {
          id: screeningAuroraTwo,
          movieProviderId: providerAurora,
          movieId: createMovieId('movie-aurora-2'),
          auditoriumId: auditoriumAuroraMain,
          startsAt: '2026-06-01T13:00:00.000Z',
          endsAt: '2026-06-01T14:58:00.000Z',
        },
        {
          id: screeningRivertonOne,
          movieProviderId: providerRiverton,
          movieId: createMovieId('movie-riverton-1'),
          auditoriumId: auditoriumRivertonOne,
          startsAt: '2026-06-02T10:00:00.000Z',
          endsAt: '2026-06-02T11:36:00.000Z',
        },
      ],
      seats: [
        {
          id: createSeatId('seat-aurora-1-a1'),
          movieProviderId: providerAurora,
          auditoriumId: auditoriumAuroraMain,
          row: 'A',
          number: 1,
        },
        {
          id: createSeatId('seat-aurora-1-a2'),
          movieProviderId: providerAurora,
          auditoriumId: auditoriumAuroraMain,
          row: 'A',
          number: 2,
        },
        {
          id: createSeatId('seat-aurora-1-a3'),
          movieProviderId: providerAurora,
          auditoriumId: auditoriumAuroraMain,
          row: 'A',
          number: 3,
        },
        {
          id: createSeatId('seat-riverton-1-b3'),
          movieProviderId: providerRiverton,
          auditoriumId: auditoriumRivertonOne,
          row: 'B',
          number: 3,
        },
      ],
      reservationRequests: [
        {
          id: createReservationRequestId('request-aurora-ada'),
          movieProviderId: providerAurora,
          screeningId: screeningAuroraOne,
          seatIds: [
            createSeatId('seat-aurora-1-a1'),
            createSeatId('seat-aurora-1-a2'),
          ],
          requestedByUserId: createUserId('user-ada'),
          status: ReservationRequestStatus.CONFIRMED,
        },
        {
          id: createReservationRequestId('request-riverton-linus'),
          movieProviderId: providerRiverton,
          screeningId: screeningRivertonOne,
          seatIds: [createSeatId('seat-riverton-1-b3')],
          requestedByUserId: createUserId('user-linus'),
          status: ReservationRequestStatus.CONFIRMED,
        },
      ],
      reservations: [
        {
          id: createReservationId('reservation-aurora-ada'),
          movieProviderId: providerAurora,
          reservationRequestId:
            createReservationRequestId('request-aurora-ada'),
          screeningId: screeningAuroraOne,
          seatIds: [
            createSeatId('seat-aurora-1-a1'),
            createSeatId('seat-aurora-1-a2'),
          ],
          reservedByUserId: createUserId('user-ada'),
          confirmedAt: '2026-06-01T09:05:00.000Z',
        },
        {
          id: createReservationId('reservation-riverton-linus'),
          movieProviderId: providerRiverton,
          reservationRequestId: createReservationRequestId(
            'request-riverton-linus',
          ),
          screeningId: screeningRivertonOne,
          seatIds: [createSeatId('seat-riverton-1-b3')],
          reservedByUserId: createUserId('user-linus'),
          confirmedAt: '2026-06-02T10:15:00.000Z',
        },
      ],
    });
  }

  async findMovieProviderById(
    movieProviderId: MovieProviderId,
  ): Promise<MovieProvider | null> {
    return this.movieProvidersById.get(movieProviderId) ?? null;
  }

  async findMoviesByProviderId(
    movieProviderId: MovieProviderId,
  ): Promise<readonly Movie[]> {
    return Array.from(this.moviesById.values()).filter(
      (movie) => movie.movieProviderId === movieProviderId,
    );
  }

  async findMovieById(
    movieProviderId: MovieProviderId,
    movieId: MovieId,
  ): Promise<Movie | null> {
    const movie = this.moviesById.get(movieId);

    if (movie === undefined || movie.movieProviderId !== movieProviderId) {
      return null;
    }

    return movie;
  }

  async findScreeningsByProviderId(
    movieProviderId: MovieProviderId,
  ): Promise<readonly Screening[]> {
    return Array.from(this.screeningsById.values()).filter(
      (screening) => screening.movieProviderId === movieProviderId,
    );
  }

  async findSeatsByScreeningId(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<readonly Seat[]> {
    const screening = this.screeningsById.get(screeningId);

    if (
      screening === undefined ||
      screening.movieProviderId !== movieProviderId
    ) {
      return [];
    }

    return Array.from(this.seatsById.values()).filter(
      (seat) =>
        seat.movieProviderId === movieProviderId &&
        seat.auditoriumId === screening.auditoriumId,
    );
  }

  async findReservationRequestById(
    reservationRequestId: ReservationRequestId,
  ): Promise<ReservationRequest | null> {
    return this.reservationRequestsById.get(reservationRequestId) ?? null;
  }

  async findReservationById(
    reservationId: ReservationId,
  ): Promise<Reservation | null> {
    return this.reservationsById.get(reservationId) ?? null;
  }
}
