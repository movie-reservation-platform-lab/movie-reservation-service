import { describe, expect, it } from 'vitest';

import { createUserId } from '../../../src/domain/authentication/user-id';
import { createMovieId } from '../../../src/domain/movie-reservations/movie-id';
import { createMovieProviderId } from '../../../src/domain/movie-reservations/movie-provider-id';
import { createReservation } from '../../../src/domain/movie-reservations/reservation';
import { createReservationRequest } from '../../../src/domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../../src/domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../../src/domain/movie-reservations/reservation-request-status';
import {
  confirmReservationRequest,
  startProcessingReservationRequest,
} from '../../../src/domain/movie-reservations/reservation-request-transitions';
import { createReservationId } from '../../../src/domain/movie-reservations/reservation-id';
import { createScreeningId } from '../../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../../src/domain/movie-reservations/seat-id';
import { InMemoryMovieReservationRepository } from '../../../src/infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';
import { InMemoryMovieReservationStore } from '../../../src/infrastructure/repositories/in-memory/in-memory-movie-reservation.store';
import { InMemoryReservationRequestWorkRepository } from '../../../src/infrastructure/repositories/in-memory/in-memory-reservation-request-work.repository';

describe('InMemoryMovieReservationRepository', () => {
  it('seeds movies for at least two movie providers', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findMovieProviderById(
        createMovieProviderId('provider-aurora'),
      ),
    ).resolves.toMatchObject({ name: 'Aurora Cinema Group' });

    const auroraMovies = await repository.findMoviesByProviderId(
      createMovieProviderId('provider-aurora'),
    );
    const rivertonMovies = await repository.findMoviesByProviderId(
      createMovieProviderId('provider-riverton'),
    );

    expect(auroraMovies).toHaveLength(2);
    expect(rivertonMovies).toHaveLength(1);
    expect(auroraMovies).not.toEqual(rivertonMovies);
  });

  it('scopes movie lookup to the requested provider', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findMovieById(
        createMovieProviderId('provider-aurora'),
        createMovieId('movie-riverton-1'),
      ),
    ).resolves.toBeNull();
  });

  it('seeds screenings and seats for provider-scoped catalog flows', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    const auroraScreenings = await repository.findScreeningsByProviderId(
      createMovieProviderId('provider-aurora'),
    );
    const auroraSeats = await repository.findSeatsByScreeningId(
      createMovieProviderId('provider-aurora'),
      createScreeningId('screening-aurora-1'),
    );

    expect(auroraScreenings).toHaveLength(2);
    expect(auroraSeats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'seat-aurora-1-a1' }),
        expect.objectContaining({ id: 'seat-aurora-1-a2' }),
      ]),
    );
  });

  it('seeds reservation request state with multiple selected seats', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('request-aurora-ada'),
      ),
    ).resolves.toMatchObject({
      movieProviderId: 'provider-aurora',
      seatIds: ['seat-aurora-1-a1', 'seat-aurora-1-a2'],
      status: ReservationRequestStatus.CONFIRMED,
    });
  });

  it('rejects saving a reservation request with an id that already exists', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.saveReservationRequest(
        createReservationRequest({
          id: createReservationRequestId('request-aurora-ada'),
          movieProviderId: createMovieProviderId('provider-aurora'),
          screeningId: createScreeningId('screening-aurora-1'),
          seatIds: [createSeatId('seat-aurora-1-a3')],
          requestedByUserId: createUserId('local-dev-user'),
        }),
      ),
    ).rejects.toThrow('Reservation request request-aurora-ada already exists');
  });

  it('returns reservations by id so application authorization can make the access decision', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();
    const reservationId = createReservationId('reservation-aurora-ada');

    await expect(
      repository.findReservationById(reservationId),
    ).resolves.toMatchObject({
      movieProviderId: 'provider-aurora',
      reservedByUserId: 'user-ada',
    });
  });

  it('returns reservations by reservation request id for result lookups', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();
    const reservationRequestId =
      createReservationRequestId('request-aurora-ada');

    await expect(
      repository.findReservationByReservationRequestId(reservationRequestId),
    ).resolves.toMatchObject({
      id: 'reservation-aurora-ada',
      movieProviderId: 'provider-aurora',
      reservationRequestId: 'request-aurora-ada',
    });
  });
});

describe('InMemoryReservationRequestWorkRepository', () => {
  it('atomically claims the lowest-sequence pending request and skips terminal requests', async () => {
    const terminalRequest = confirmReservationRequest(
      startProcessingReservationRequest(
        createTestReservationRequest('request-terminal', 'seat-a1'),
      ),
    );
    const nextPendingRequest = createTestReservationRequest(
      'request-next',
      'seat-a2',
    );
    const laterPendingRequest = createTestReservationRequest(
      'request-later',
      'seat-a3',
    );
    const store = new InMemoryMovieReservationStore({
      movieProviders: [],
      auditoriums: [],
      movies: [],
      screenings: [],
      seats: [],
      reservationRequests: [
        terminalRequest,
        nextPendingRequest,
        laterPendingRequest,
      ],
      reservations: [],
    });
    const workRepository = new InMemoryReservationRequestWorkRepository(store);

    const firstClaim =
      await workRepository.claimNextPendingReservationRequest();
    const secondClaim =
      await workRepository.claimNextPendingReservationRequest();

    expect(firstClaim).toMatchObject({
      reservationRequest: {
        id: 'request-next',
        status: ReservationRequestStatus.PROCESSING,
      },
      sequence: 2,
    });
    expect(secondClaim).toMatchObject({
      reservationRequest: {
        id: 'request-later',
        status: ReservationRequestStatus.PROCESSING,
      },
      sequence: 3,
    });
  });

  it('saves the reservation and marks the claimed request confirmed together', async () => {
    const pendingRequest = createTestReservationRequest(
      'request-confirmed',
      'seat-a1',
    );
    const store = new InMemoryMovieReservationStore({
      movieProviders: [],
      auditoriums: [],
      movies: [],
      screenings: [],
      seats: [],
      reservationRequests: [pendingRequest],
      reservations: [],
    });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const claimedWorkItem =
      await workRepository.claimNextPendingReservationRequest();

    if (claimedWorkItem === null) {
      throw new Error('Expected pending request to be claimed');
    }

    const reservation = createReservation({
      id: createReservationId('reservation-confirmed'),
      movieProviderId: claimedWorkItem.reservationRequest.movieProviderId,
      reservationRequestId: claimedWorkItem.reservationRequest.id,
      screeningId: claimedWorkItem.reservationRequest.screeningId,
      seatIds: claimedWorkItem.reservationRequest.seatIds,
      reservedByUserId: claimedWorkItem.reservationRequest.requestedByUserId,
      confirmedAt: '2026-06-01T09:00:00.000Z',
    });

    await expect(
      workRepository.confirmClaimedReservationRequest({
        claimedWorkItem,
        reservation,
      }),
    ).resolves.toMatchObject({
      id: 'request-confirmed',
      status: ReservationRequestStatus.CONFIRMED,
    });
    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('request-confirmed'),
      ),
    ).resolves.toMatchObject({
      status: ReservationRequestStatus.CONFIRMED,
    });
    await expect(
      repository.findReservationById(
        createReservationId('reservation-confirmed'),
      ),
    ).resolves.toMatchObject({
      reservationRequestId: 'request-confirmed',
      seatIds: ['seat-a1'],
    });
  });
});

function createTestReservationRequest(id: string, seatId: string) {
  return createReservationRequest({
    id: createReservationRequestId(id),
    movieProviderId: createMovieProviderId('provider-1'),
    screeningId: createScreeningId('screening-1'),
    seatIds: [createSeatId(seatId)],
    requestedByUserId: createUserId('user-1'),
  });
}
