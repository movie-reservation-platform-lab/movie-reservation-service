import { createUserId } from '../../../domain/authentication/user-id';
import type { Auditorium } from '../../../domain/movie-reservations/auditorium';
import { createAuditoriumId } from '../../../domain/movie-reservations/auditorium-id';
import type { Movie } from '../../../domain/movie-reservations/movie';
import { createMovieId } from '../../../domain/movie-reservations/movie-id';
import type { MovieProvider } from '../../../domain/movie-reservations/movie-provider';
import { createMovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import { createReservation, type Reservation } from '../../../domain/movie-reservations/reservation';
import { createReservationId } from '../../../domain/movie-reservations/reservation-id';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';
import type { Screening } from '../../../domain/movie-reservations/screening';
import { createScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { Seat } from '../../../domain/movie-reservations/seat';
import { createSeatId } from '../../../domain/movie-reservations/seat-id';

export const MOVIE_RESERVATION_DEMO_IDS = {
  providers: {
    aurora: '11111111-1111-4111-8111-111111111111',
    riverton: '22222222-2222-4222-8222-222222222222',
  },
  providerCodes: {
    aurora: 'aurora-silver-maple',
    riverton: 'riverton-picture-house',
  },
  auditoriums: {
    auroraMain: '33333333-3333-4333-8333-333333333331',
    rivertonOne: '33333333-3333-4333-8333-333333333332',
  },
  movies: {
    auroraTypeSafeMatinee: '44444444-4444-4444-8444-444444444441',
    auroraFargateAtMidnight: '44444444-4444-4444-8444-444444444442',
    rivertonLastDeployment: '44444444-4444-4444-8444-444444444443',
  },
  screenings: {
    auroraTypeSafeMatineeMorning: '55555555-5555-4555-8555-555555555551',
    auroraFargateAtMidnightAfternoon: '55555555-5555-4555-8555-555555555552',
    rivertonLastDeploymentMorning: '55555555-5555-4555-8555-555555555553',
  },
  seats: {
    auroraA1: '66666666-6666-4666-8666-666666666661',
    auroraA2: '66666666-6666-4666-8666-666666666662',
    auroraA3: '66666666-6666-4666-8666-666666666663',
    rivertonB3: '66666666-6666-4666-8666-666666666664',
  },
  reservationRequests: {
    auroraAda: '77777777-7777-4777-8777-777777777771',
    rivertonLinus: '77777777-7777-4777-8777-777777777772',
  },
  reservations: {
    auroraAda: '88888888-8888-4888-8888-888888888881',
    rivertonLinus: '88888888-8888-4888-8888-888888888882',
  },
} as const;

export interface MovieReservationDemoData {
  readonly movieProviders: readonly MovieProvider[];
  readonly auditoriums: readonly Auditorium[];
  readonly movies: readonly Movie[];
  readonly screenings: readonly Screening[];
  readonly seats: readonly Seat[];
  readonly reservationRequests: readonly ReservationRequest[];
  readonly reservations: readonly Reservation[];
}

/**
 * Shared local/test catalog used by both in-memory mode and Postgres seeds.
 *
 * UUID ids mirror the Postgres primary key shape while names, titles, row
 * labels, and provider codes keep the sample data readable.
 */
export function createMovieReservationDemoData(): MovieReservationDemoData {
  const providerAurora = createMovieProviderId(MOVIE_RESERVATION_DEMO_IDS.providers.aurora);
  const providerRiverton = createMovieProviderId(MOVIE_RESERVATION_DEMO_IDS.providers.riverton);
  const auditoriumAuroraMain = createAuditoriumId(MOVIE_RESERVATION_DEMO_IDS.auditoriums.auroraMain);
  const auditoriumRivertonOne = createAuditoriumId(MOVIE_RESERVATION_DEMO_IDS.auditoriums.rivertonOne);
  const movieAuroraOne = createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraTypeSafeMatinee);
  const movieAuroraTwo = createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraFargateAtMidnight);
  const movieRivertonOne = createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.rivertonLastDeployment);
  const screeningAuroraOne = createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning);
  const screeningAuroraTwo = createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraFargateAtMidnightAfternoon);
  const screeningRivertonOne = createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.rivertonLastDeploymentMorning);
  const seatAuroraA1 = createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA1);
  const seatAuroraA2 = createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA2);
  const seatAuroraA3 = createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3);
  const seatRivertonB3 = createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.rivertonB3);
  const requestAuroraAda = createReservationRequestId(MOVIE_RESERVATION_DEMO_IDS.reservationRequests.auroraAda);
  const requestRivertonLinus = createReservationRequestId(MOVIE_RESERVATION_DEMO_IDS.reservationRequests.rivertonLinus);

  return {
    movieProviders: [
      {
        id: providerAurora,
        code: MOVIE_RESERVATION_DEMO_IDS.providerCodes.aurora,
        name: 'Aurora Cinema Group',
      },
      {
        id: providerRiverton,
        code: MOVIE_RESERVATION_DEMO_IDS.providerCodes.riverton,
        name: 'Riverton Picture House',
      },
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
        id: movieAuroraOne,
        movieProviderId: providerAurora,
        title: 'The Type-Safe Matinee',
        rating: 'PG',
        durationMinutes: 102,
      },
      {
        id: movieAuroraTwo,
        movieProviderId: providerAurora,
        title: 'Fargate at Midnight',
        rating: 'PG-13',
        durationMinutes: 118,
      },
      {
        id: movieRivertonOne,
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
        movieId: movieAuroraOne,
        auditoriumId: auditoriumAuroraMain,
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:42:00.000Z',
      },
      {
        id: screeningAuroraTwo,
        movieProviderId: providerAurora,
        movieId: movieAuroraTwo,
        auditoriumId: auditoriumAuroraMain,
        startsAt: '2026-06-01T13:00:00.000Z',
        endsAt: '2026-06-01T14:58:00.000Z',
      },
      {
        id: screeningRivertonOne,
        movieProviderId: providerRiverton,
        movieId: movieRivertonOne,
        auditoriumId: auditoriumRivertonOne,
        startsAt: '2026-06-02T10:00:00.000Z',
        endsAt: '2026-06-02T11:36:00.000Z',
      },
    ],
    seats: [
      {
        id: seatAuroraA1,
        movieProviderId: providerAurora,
        auditoriumId: auditoriumAuroraMain,
        row: 'A',
        number: 1,
      },
      {
        id: seatAuroraA2,
        movieProviderId: providerAurora,
        auditoriumId: auditoriumAuroraMain,
        row: 'A',
        number: 2,
      },
      {
        id: seatAuroraA3,
        movieProviderId: providerAurora,
        auditoriumId: auditoriumAuroraMain,
        row: 'A',
        number: 3,
      },
      {
        id: seatRivertonB3,
        movieProviderId: providerRiverton,
        auditoriumId: auditoriumRivertonOne,
        row: 'B',
        number: 3,
      },
    ],
    reservationRequests: [
      {
        id: requestAuroraAda,
        movieProviderId: providerAurora,
        screeningId: screeningAuroraOne,
        seatIds: [seatAuroraA1, seatAuroraA2],
        requestedByUserId: createUserId('user-ada'),
        status: ReservationRequestStatus.CONFIRMED,
      },
      {
        id: requestRivertonLinus,
        movieProviderId: providerRiverton,
        screeningId: screeningRivertonOne,
        seatIds: [seatRivertonB3],
        requestedByUserId: createUserId('user-linus'),
        status: ReservationRequestStatus.CONFIRMED,
      },
    ],
    reservations: [
      createReservation({
        id: createReservationId(MOVIE_RESERVATION_DEMO_IDS.reservations.auroraAda),
        movieProviderId: providerAurora,
        reservationRequestId: requestAuroraAda,
        screeningId: screeningAuroraOne,
        seatIds: [seatAuroraA1, seatAuroraA2],
        reservedByUserId: createUserId('user-ada'),
        confirmedAt: '2026-06-01T09:05:00.000Z',
      }),
      createReservation({
        id: createReservationId(MOVIE_RESERVATION_DEMO_IDS.reservations.rivertonLinus),
        movieProviderId: providerRiverton,
        reservationRequestId: requestRivertonLinus,
        screeningId: screeningRivertonOne,
        seatIds: [seatRivertonB3],
        reservedByUserId: createUserId('user-linus'),
        confirmedAt: '2026-06-02T10:15:00.000Z',
      }),
    ],
  };
}
