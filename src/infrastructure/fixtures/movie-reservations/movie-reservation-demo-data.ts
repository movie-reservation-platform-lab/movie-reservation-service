import { createUserId } from '../../../domain/authentication/user-id';
import type { Auditorium } from '../../../domain/movie-reservations/auditorium';
import { createAuditoriumId, type AuditoriumId } from '../../../domain/movie-reservations/auditorium-id';
import type { Movie } from '../../../domain/movie-reservations/movie';
import { createMovieId } from '../../../domain/movie-reservations/movie-id';
import type { MovieProvider } from '../../../domain/movie-reservations/movie-provider';
import { createMovieProviderId, type MovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
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
    auroraStudio: '33333333-3333-4333-8333-333333333333',
    auroraGrand: '33333333-3333-4333-8333-333333333334',
    rivertonOne: '33333333-3333-4333-8333-333333333332',
  },
  movies: {
    auroraShawshankRedemption: '44444444-4444-4444-8444-444444444434',
    auroraMatrix: '44444444-4444-4444-8444-444444444435',
    auroraEmpireStrikesBack: '44444444-4444-4444-8444-444444444436',
    auroraStarWarsNewHope: '44444444-4444-4444-8444-444444444437',
    auroraDarkKnight: '44444444-4444-4444-8444-444444444438',
    auroraArlingtonRoad: '44444444-4444-4444-8444-444444444439',
    auroraTypeSafeMatinee: '44444444-4444-4444-8444-444444444441',
    auroraFargateAtMidnight: '44444444-4444-4444-8444-444444444442',
    rivertonLastDeployment: '44444444-4444-4444-8444-444444444443',
    rivertonCasablanca: '44444444-4444-4444-8444-444444444444',
  },
  screenings: {
    auroraShawshankEvening: '55555555-5555-4555-8555-555555555541',
    auroraMatrixLate: '55555555-5555-4555-8555-555555555542',
    auroraEmpireStrikesBackMatinee: '55555555-5555-4555-8555-555555555543',
    auroraStarWarsNewHopeAfternoon: '55555555-5555-4555-8555-555555555544',
    auroraDarkKnightEvening: '55555555-5555-4555-8555-555555555545',
    auroraArlingtonRoadLate: '55555555-5555-4555-8555-555555555546',
    auroraTypeSafeMatineeMorning: '55555555-5555-4555-8555-555555555551',
    auroraFargateAtMidnightAfternoon: '55555555-5555-4555-8555-555555555552',
    rivertonLastDeploymentMorning: '55555555-5555-4555-8555-555555555553',
    rivertonCasablancaAfternoon: '55555555-5555-4555-8555-555555555554',
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
  const providerIds = {
    aurora: createMovieProviderId(MOVIE_RESERVATION_DEMO_IDS.providers.aurora),
    riverton: createMovieProviderId(MOVIE_RESERVATION_DEMO_IDS.providers.riverton),
  } as const;
  const auditoriumIds = {
    auroraMain: createAuditoriumId(MOVIE_RESERVATION_DEMO_IDS.auditoriums.auroraMain),
    auroraStudio: createAuditoriumId(MOVIE_RESERVATION_DEMO_IDS.auditoriums.auroraStudio),
    auroraGrand: createAuditoriumId(MOVIE_RESERVATION_DEMO_IDS.auditoriums.auroraGrand),
    rivertonOne: createAuditoriumId(MOVIE_RESERVATION_DEMO_IDS.auditoriums.rivertonOne),
  } as const;
  const movieIds = {
    auroraShawshankRedemption: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraShawshankRedemption),
    auroraMatrix: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraMatrix),
    auroraEmpireStrikesBack: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraEmpireStrikesBack),
    auroraStarWarsNewHope: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraStarWarsNewHope),
    auroraDarkKnight: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraDarkKnight),
    auroraArlingtonRoad: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraArlingtonRoad),
    auroraTypeSafeMatinee: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraTypeSafeMatinee),
    auroraFargateAtMidnight: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.auroraFargateAtMidnight),
    rivertonLastDeployment: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.rivertonLastDeployment),
    rivertonCasablanca: createMovieId(MOVIE_RESERVATION_DEMO_IDS.movies.rivertonCasablanca),
  } as const;
  const screeningIds = {
    auroraShawshankEvening: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraShawshankEvening),
    auroraMatrixLate: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraMatrixLate),
    auroraEmpireStrikesBackMatinee: createScreeningId(
      MOVIE_RESERVATION_DEMO_IDS.screenings.auroraEmpireStrikesBackMatinee,
    ),
    auroraStarWarsNewHopeAfternoon: createScreeningId(
      MOVIE_RESERVATION_DEMO_IDS.screenings.auroraStarWarsNewHopeAfternoon,
    ),
    auroraDarkKnightEvening: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraDarkKnightEvening),
    auroraArlingtonRoadLate: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraArlingtonRoadLate),
    auroraTypeSafeMatineeMorning: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning),
    auroraFargateAtMidnightAfternoon: createScreeningId(
      MOVIE_RESERVATION_DEMO_IDS.screenings.auroraFargateAtMidnightAfternoon,
    ),
    rivertonLastDeploymentMorning: createScreeningId(
      MOVIE_RESERVATION_DEMO_IDS.screenings.rivertonLastDeploymentMorning,
    ),
    rivertonCasablancaAfternoon: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.rivertonCasablancaAfternoon),
  } as const;
  const seatIds = {
    auroraA1: createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA1),
    auroraA2: createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA2),
    auroraA3: createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3),
    rivertonB3: createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.rivertonB3),
  } as const;
  const requestIds = {
    auroraAda: createReservationRequestId(MOVIE_RESERVATION_DEMO_IDS.reservationRequests.auroraAda),
    rivertonLinus: createReservationRequestId(MOVIE_RESERVATION_DEMO_IDS.reservationRequests.rivertonLinus),
  } as const;

  return {
    movieProviders: [
      {
        id: providerIds.aurora,
        code: MOVIE_RESERVATION_DEMO_IDS.providerCodes.aurora,
        name: 'Aurora Cinema Group',
      },
      {
        id: providerIds.riverton,
        code: MOVIE_RESERVATION_DEMO_IDS.providerCodes.riverton,
        name: 'Riverton Picture House',
      },
    ],
    auditoriums: [
      {
        id: auditoriumIds.auroraMain,
        movieProviderId: providerIds.aurora,
        name: 'Aurora Main Hall',
      },
      {
        id: auditoriumIds.auroraStudio,
        movieProviderId: providerIds.aurora,
        name: 'Aurora Studio Two',
      },
      {
        id: auditoriumIds.auroraGrand,
        movieProviderId: providerIds.aurora,
        name: 'Aurora Grand Screen',
      },
      {
        id: auditoriumIds.rivertonOne,
        movieProviderId: providerIds.riverton,
        name: 'Riverton Screen 1',
      },
    ],
    movies: [
      {
        id: movieIds.auroraShawshankRedemption,
        movieProviderId: providerIds.aurora,
        title: 'The Shawshank Redemption',
        rating: 'R',
        durationMinutes: 142,
      },
      {
        id: movieIds.auroraMatrix,
        movieProviderId: providerIds.aurora,
        title: 'The Matrix',
        rating: 'R',
        durationMinutes: 136,
      },
      {
        id: movieIds.auroraEmpireStrikesBack,
        movieProviderId: providerIds.aurora,
        title: 'Star Wars: Episode V - The Empire Strikes Back',
        rating: 'PG',
        durationMinutes: 124,
      },
      {
        id: movieIds.auroraStarWarsNewHope,
        movieProviderId: providerIds.aurora,
        title: 'Star Wars: Episode IV - A New Hope',
        rating: 'PG',
        durationMinutes: 121,
      },
      {
        id: movieIds.auroraDarkKnight,
        movieProviderId: providerIds.aurora,
        title: 'The Dark Knight',
        rating: 'PG-13',
        durationMinutes: 152,
      },
      {
        id: movieIds.auroraArlingtonRoad,
        movieProviderId: providerIds.aurora,
        title: 'Arlington Road',
        rating: 'R',
        durationMinutes: 117,
      },
      {
        id: movieIds.auroraTypeSafeMatinee,
        movieProviderId: providerIds.aurora,
        title: 'The Type-Safe Matinee',
        rating: 'PG',
        durationMinutes: 102,
      },
      {
        id: movieIds.auroraFargateAtMidnight,
        movieProviderId: providerIds.aurora,
        title: 'Fargate at Midnight',
        rating: 'PG-13',
        durationMinutes: 118,
      },
      {
        id: movieIds.rivertonLastDeployment,
        movieProviderId: providerIds.riverton,
        title: 'The Last Deployment',
        rating: 'PG',
        durationMinutes: 96,
      },
      {
        id: movieIds.rivertonCasablanca,
        movieProviderId: providerIds.riverton,
        title: 'Casablanca',
        rating: 'PG',
        durationMinutes: 102,
      },
    ],
    screenings: [
      {
        id: screeningIds.auroraShawshankEvening,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraShawshankRedemption,
        auditoriumId: auditoriumIds.auroraGrand,
        startsAt: '2026-06-01T18:30:00.000Z',
        endsAt: '2026-06-01T20:52:00.000Z',
      },
      {
        id: screeningIds.auroraMatrixLate,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraMatrix,
        auditoriumId: auditoriumIds.auroraStudio,
        startsAt: '2026-06-01T21:30:00.000Z',
        endsAt: '2026-06-01T23:46:00.000Z',
      },
      {
        id: screeningIds.auroraEmpireStrikesBackMatinee,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraEmpireStrikesBack,
        auditoriumId: auditoriumIds.auroraGrand,
        startsAt: '2026-06-02T14:00:00.000Z',
        endsAt: '2026-06-02T16:04:00.000Z',
      },
      {
        id: screeningIds.auroraStarWarsNewHopeAfternoon,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraStarWarsNewHope,
        auditoriumId: auditoriumIds.auroraMain,
        startsAt: '2026-06-02T16:30:00.000Z',
        endsAt: '2026-06-02T18:31:00.000Z',
      },
      {
        id: screeningIds.auroraDarkKnightEvening,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraDarkKnight,
        auditoriumId: auditoriumIds.auroraGrand,
        startsAt: '2026-06-02T19:30:00.000Z',
        endsAt: '2026-06-02T22:02:00.000Z',
      },
      {
        id: screeningIds.auroraArlingtonRoadLate,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraArlingtonRoad,
        auditoriumId: auditoriumIds.auroraStudio,
        startsAt: '2026-06-02T22:20:00.000Z',
        endsAt: '2026-06-03T00:17:00.000Z',
      },
      {
        id: screeningIds.auroraTypeSafeMatineeMorning,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraTypeSafeMatinee,
        auditoriumId: auditoriumIds.auroraMain,
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:42:00.000Z',
      },
      {
        id: screeningIds.auroraFargateAtMidnightAfternoon,
        movieProviderId: providerIds.aurora,
        movieId: movieIds.auroraFargateAtMidnight,
        auditoriumId: auditoriumIds.auroraStudio,
        startsAt: '2026-06-01T13:00:00.000Z',
        endsAt: '2026-06-01T14:58:00.000Z',
      },
      {
        id: screeningIds.rivertonLastDeploymentMorning,
        movieProviderId: providerIds.riverton,
        movieId: movieIds.rivertonLastDeployment,
        auditoriumId: auditoriumIds.rivertonOne,
        startsAt: '2026-06-02T10:00:00.000Z',
        endsAt: '2026-06-02T11:36:00.000Z',
      },
      {
        id: screeningIds.rivertonCasablancaAfternoon,
        movieProviderId: providerIds.riverton,
        movieId: movieIds.rivertonCasablanca,
        auditoriumId: auditoriumIds.rivertonOne,
        startsAt: '2026-06-02T15:00:00.000Z',
        endsAt: '2026-06-02T16:42:00.000Z',
      },
    ],
    seats: [
      ...createSeatGrid({
        movieProviderId: providerIds.aurora,
        auditoriumId: auditoriumIds.auroraMain,
        rows: ['A', 'B', 'C', 'D'],
        seatsPerRow: 8,
        generatedIdStart: 700,
        fixedSeatIds: [
          { row: 'A', number: 1, id: seatIds.auroraA1 },
          { row: 'A', number: 2, id: seatIds.auroraA2 },
          { row: 'A', number: 3, id: seatIds.auroraA3 },
        ],
      }),
      ...createSeatGrid({
        movieProviderId: providerIds.aurora,
        auditoriumId: auditoriumIds.auroraStudio,
        rows: ['A', 'B', 'C'],
        seatsPerRow: 6,
        generatedIdStart: 740,
      }),
      ...createSeatGrid({
        movieProviderId: providerIds.aurora,
        auditoriumId: auditoriumIds.auroraGrand,
        rows: ['A', 'B', 'C', 'D', 'E'],
        seatsPerRow: 10,
        generatedIdStart: 760,
      }),
      ...createSeatGrid({
        movieProviderId: providerIds.riverton,
        auditoriumId: auditoriumIds.rivertonOne,
        rows: ['A', 'B', 'C', 'D'],
        seatsPerRow: 6,
        generatedIdStart: 840,
        fixedSeatIds: [{ row: 'B', number: 3, id: seatIds.rivertonB3 }],
      }),
    ],
    reservationRequests: [
      {
        id: requestIds.auroraAda,
        movieProviderId: providerIds.aurora,
        screeningId: screeningIds.auroraTypeSafeMatineeMorning,
        seatIds: [seatIds.auroraA1, seatIds.auroraA2],
        requestedByUserId: createUserId('user-ada'),
        status: ReservationRequestStatus.CONFIRMED,
      },
      {
        id: requestIds.rivertonLinus,
        movieProviderId: providerIds.riverton,
        screeningId: screeningIds.rivertonLastDeploymentMorning,
        seatIds: [seatIds.rivertonB3],
        requestedByUserId: createUserId('user-linus'),
        status: ReservationRequestStatus.CONFIRMED,
      },
    ],
    reservations: [
      createReservation({
        id: createReservationId(MOVIE_RESERVATION_DEMO_IDS.reservations.auroraAda),
        movieProviderId: providerIds.aurora,
        reservationRequestId: requestIds.auroraAda,
        screeningId: screeningIds.auroraTypeSafeMatineeMorning,
        seatIds: [seatIds.auroraA1, seatIds.auroraA2],
        reservedByUserId: createUserId('user-ada'),
        confirmedAt: '2026-06-01T09:05:00.000Z',
      }),
      createReservation({
        id: createReservationId(MOVIE_RESERVATION_DEMO_IDS.reservations.rivertonLinus),
        movieProviderId: providerIds.riverton,
        reservationRequestId: requestIds.rivertonLinus,
        screeningId: screeningIds.rivertonLastDeploymentMorning,
        seatIds: [seatIds.rivertonB3],
        reservedByUserId: createUserId('user-linus'),
        confirmedAt: '2026-06-02T10:15:00.000Z',
      }),
    ],
  };
}

interface SeatGridInput {
  readonly movieProviderId: MovieProviderId;
  readonly auditoriumId: AuditoriumId;
  readonly rows: readonly string[];
  readonly seatsPerRow: number;
  readonly generatedIdStart: number;
  readonly fixedSeatIds?: readonly FixedSeatId[];
}

interface FixedSeatId {
  readonly row: string;
  readonly number: number;
  readonly id: ReturnType<typeof createSeatId>;
}

/**
 * Builds deterministic demo seats without hiding the important catalog shape.
 *
 * The named fixed ids keep older tests and learning scenarios stable, while
 * generated ids make the demo auditoriums feel like real screens instead of
 * three-seat placeholders.
 */
function createSeatGrid(input: SeatGridInput): readonly Seat[] {
  const fixedSeatIds = new Map(input.fixedSeatIds?.map((seat) => [formatSeatKey(seat.row, seat.number), seat.id]));

  return input.rows.flatMap((row, rowIndex) =>
    Array.from({ length: input.seatsPerRow }, (_, seatIndex) => {
      const number = seatIndex + 1;
      const generatedSeatId = createSeatId(
        createGeneratedSeatId(input.generatedIdStart + rowIndex * input.seatsPerRow + seatIndex),
      );

      return {
        id: fixedSeatIds.get(formatSeatKey(row, number)) ?? generatedSeatId,
        movieProviderId: input.movieProviderId,
        auditoriumId: input.auditoriumId,
        row,
        number,
      };
    }),
  );
}

function formatSeatKey(row: string, number: number): string {
  return `${row}:${number}`;
}

function createGeneratedSeatId(sequence: number): string {
  return `66666666-6666-4666-8666-666666666${sequence.toString().padStart(3, '0')}`;
}
