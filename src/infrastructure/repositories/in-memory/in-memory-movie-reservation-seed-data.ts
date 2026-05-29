import { createUserId } from '../../../domain/authentication/user-id';
import { createAuditoriumId } from '../../../domain/movie-reservations/auditorium-id';
import { createMovieId } from '../../../domain/movie-reservations/movie-id';
import { createMovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import { createReservation } from '../../../domain/movie-reservations/reservation';
import { createReservationId } from '../../../domain/movie-reservations/reservation-id';
import { createReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';
import { createScreeningId } from '../../../domain/movie-reservations/screening-id';
import { createSeatId } from '../../../domain/movie-reservations/seat-id';
import type { InMemoryMovieReservationStoreInput } from './in-memory-movie-reservation.store';

/**
 * Local/demo seed data for the in-memory movie reservation store.
 *
 * The fake store owns persistence behavior. This module owns the hardcoded
 * catalog and confirmed reservation examples used by local development and
 * integration tests.
 */
export function createInMemoryMovieReservationSeedData(): InMemoryMovieReservationStoreInput {
  const providerAurora = createMovieProviderId('provider-aurora');
  const providerRiverton = createMovieProviderId('provider-riverton');
  const auditoriumAuroraMain = createAuditoriumId('auditorium-aurora-main');
  const auditoriumRivertonOne = createAuditoriumId('auditorium-riverton-1');
  const screeningAuroraOne = createScreeningId('screening-aurora-1');
  const screeningAuroraTwo = createScreeningId('screening-aurora-2');
  const screeningRivertonOne = createScreeningId('screening-riverton-1');

  return {
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
      createReservation({
        id: createReservationId('reservation-aurora-ada'),
        movieProviderId: providerAurora,
        reservationRequestId: createReservationRequestId('request-aurora-ada'),
        screeningId: screeningAuroraOne,
        seatIds: [
          createSeatId('seat-aurora-1-a1'),
          createSeatId('seat-aurora-1-a2'),
        ],
        reservedByUserId: createUserId('user-ada'),
        confirmedAt: '2026-06-01T09:05:00.000Z',
      }),
      createReservation({
        id: createReservationId('reservation-riverton-linus'),
        movieProviderId: providerRiverton,
        reservationRequestId: createReservationRequestId(
          'request-riverton-linus',
        ),
        screeningId: screeningRivertonOne,
        seatIds: [createSeatId('seat-riverton-1-b3')],
        reservedByUserId: createUserId('user-linus'),
        confirmedAt: '2026-06-02T10:15:00.000Z',
      }),
    ],
  };
}
