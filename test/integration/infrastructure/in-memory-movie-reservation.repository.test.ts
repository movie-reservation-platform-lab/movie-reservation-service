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
      repository.findMovieProviderById(createMovieProviderId('11111111-1111-4111-8111-111111111111')),
    ).resolves.toMatchObject({ name: 'Aurora Cinema Group' });

    const auroraMovies = await repository.findMoviesByProviderId(
      createMovieProviderId('11111111-1111-4111-8111-111111111111'),
    );
    const rivertonMovies = await repository.findMoviesByProviderId(
      createMovieProviderId('22222222-2222-4222-8222-222222222222'),
    );

    expect(auroraMovies).toHaveLength(2);
    expect(rivertonMovies).toHaveLength(1);
    expect(auroraMovies).not.toEqual(rivertonMovies);
  });

  it('scopes movie lookup to the requested provider', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findMovieById(
        createMovieProviderId('11111111-1111-4111-8111-111111111111'),
        createMovieId('44444444-4444-4444-8444-444444444443'),
      ),
    ).resolves.toBeNull();
  });

  it('seeds screenings and seats for provider-scoped catalog flows', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    const auroraScreenings = await repository.findScreeningsByProviderId(
      createMovieProviderId('11111111-1111-4111-8111-111111111111'),
    );
    const auroraSeats = await repository.findSeatsByScreeningId(
      createMovieProviderId('11111111-1111-4111-8111-111111111111'),
      createScreeningId('55555555-5555-4555-8555-555555555551'),
    );

    expect(auroraScreenings).toHaveLength(2);
    expect(auroraSeats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '66666666-6666-4666-8666-666666666661' }),
        expect.objectContaining({ id: '66666666-6666-4666-8666-666666666662' }),
      ]),
    );
  });

  it('seeds reservation request state with multiple selected seats', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findReservationRequestById(createReservationRequestId('77777777-7777-4777-8777-777777777771')),
    ).resolves.toMatchObject({
      movieProviderId: '11111111-1111-4111-8111-111111111111',
      seatIds: ['66666666-6666-4666-8666-666666666661', '66666666-6666-4666-8666-666666666662'],
      status: ReservationRequestStatus.CONFIRMED,
    });
  });

  it('rejects saving a reservation request with an id that already exists', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.saveReservationRequest(
        createReservationRequest({
          id: createReservationRequestId('77777777-7777-4777-8777-777777777771'),
          movieProviderId: createMovieProviderId('11111111-1111-4111-8111-111111111111'),
          screeningId: createScreeningId('55555555-5555-4555-8555-555555555551'),
          seatIds: [createSeatId('66666666-6666-4666-8666-666666666663')],
          requestedByUserId: createUserId('local-dev-user'),
        }),
      ),
    ).rejects.toThrow('Reservation request 77777777-7777-4777-8777-777777777771 already exists');
  });

  it('returns reservations by id so application authorization can make the access decision', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();
    const reservationId = createReservationId('88888888-8888-4888-8888-888888888881');

    await expect(repository.findReservationById(reservationId)).resolves.toMatchObject({
      movieProviderId: '11111111-1111-4111-8111-111111111111',
      reservedByUserId: 'user-ada',
    });
  });

  it('returns reservations by reservation request id for result lookups', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();
    const reservationRequestId = createReservationRequestId('77777777-7777-4777-8777-777777777771');

    await expect(repository.findReservationByReservationRequestId(reservationRequestId)).resolves.toMatchObject({
      id: '88888888-8888-4888-8888-888888888881',
      movieProviderId: '11111111-1111-4111-8111-111111111111',
      reservationRequestId: '77777777-7777-4777-8777-777777777771',
    });
  });
});

describe('InMemoryReservationRequestWorkRepository', () => {
  it('atomically claims the lowest-sequence pending request and skips terminal requests', async () => {
    const terminalRequest = confirmReservationRequest(
      startProcessingReservationRequest(
        createTestReservationRequest('99999999-9999-4999-8999-999999999918', '99999999-9999-4999-8999-999999999903'),
      ),
    );
    const nextPendingRequest = createTestReservationRequest(
      '99999999-9999-4999-8999-999999999922',
      '99999999-9999-4999-8999-999999999904',
    );
    const laterPendingRequest = createTestReservationRequest(
      '99999999-9999-4999-8999-999999999923',
      '99999999-9999-4999-8999-999999999905',
    );
    const store = new InMemoryMovieReservationStore({
      movieProviders: [],
      auditoriums: [],
      movies: [],
      screenings: [],
      seats: [],
      reservationRequests: [terminalRequest, nextPendingRequest, laterPendingRequest],
      reservations: [],
    });
    const workRepository = new InMemoryReservationRequestWorkRepository(store);

    const firstClaim = await workRepository.claimNextPendingReservationRequest(createClaimInput('claim-1'));
    const secondClaim = await workRepository.claimNextPendingReservationRequest(createClaimInput('claim-2'));

    expect(firstClaim).toMatchObject({
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999922',
        status: ReservationRequestStatus.PROCESSING,
      },
      sequence: 2,
    });
    expect(secondClaim).toMatchObject({
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999923',
        status: ReservationRequestStatus.PROCESSING,
      },
      sequence: 3,
    });
  });

  it('heartbeats an owned claim and reclaims it only after the lease expires', async () => {
    const pendingRequest = createTestReservationRequest(
      '99999999-9999-4999-8999-999999999926',
      '99999999-9999-4999-8999-999999999903',
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
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const firstClaim = await workRepository.claimNextPendingReservationRequest(
      createClaimInput('claim-before-heartbeat'),
    );

    if (firstClaim === null) {
      throw new Error('Expected pending request to be claimed');
    }

    await expect(
      workRepository.heartbeatClaimedReservationRequest({
        claimedWorkItem: firstClaim,
        heartbeatAt: '2026-06-01T08:59:10.000Z',
        claimExpiresAt: '2026-06-01T08:59:40.000Z',
      }),
    ).resolves.toBe(true);
    await expect(
      workRepository.claimNextPendingReservationRequest(
        createClaimInput('claim-before-expiry', '2026-06-01T08:59:20.000Z'),
      ),
    ).resolves.toBeNull();

    const reclaimedClaim = await workRepository.claimNextPendingReservationRequest(
      createClaimInput('claim-after-expiry', '2026-06-01T08:59:41.000Z'),
    );

    expect(reclaimedClaim).toMatchObject({
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999926',
        status: ReservationRequestStatus.PROCESSING,
      },
      leaseTimeoutCount: 1,
      transientFailureCount: 0,
      claimToken: 'claim-after-expiry',
    });
  });

  it('fails an expired processing request after the lease timeout budget is used', async () => {
    const pendingRequest = createTestReservationRequest(
      '99999999-9999-4999-8999-999999999927',
      '99999999-9999-4999-8999-999999999903',
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
    const firstClaim = await workRepository.claimNextPendingReservationRequest(
      createClaimInput('claim-before-timeout', '2026-06-01T08:59:00.000Z', {
        maxLeaseTimeouts: 1,
      }),
    );

    if (firstClaim === null) {
      throw new Error('Expected pending request to be claimed');
    }

    await expect(
      workRepository.claimNextPendingReservationRequest(
        createClaimInput('claim-after-first-timeout', '2026-06-01T08:59:31.000Z', {
          maxLeaseTimeouts: 1,
        }),
      ),
    ).resolves.toMatchObject({
      leaseTimeoutCount: 1,
      transientFailureCount: 0,
    });
    await expect(
      workRepository.claimNextPendingReservationRequest(
        createClaimInput('claim-after-second-timeout', '2026-06-01T09:00:02.000Z', { maxLeaseTimeouts: 1 }),
      ),
    ).resolves.toBeNull();
    await expect(
      repository.findReservationRequestById(createReservationRequestId('99999999-9999-4999-8999-999999999927')),
    ).resolves.toMatchObject({
      status: ReservationRequestStatus.FAILED,
    });
    await expect(
      workRepository.findReservationRequestProcessingAttemptsByRequestId(
        createReservationRequestId('99999999-9999-4999-8999-999999999927'),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: 'failed',
        reason: 'lease-timeout',
      }),
    ]);
  });

  it('saves the reservation and marks the claimed request confirmed together', async () => {
    const pendingRequest = createTestReservationRequest(
      '99999999-9999-4999-8999-999999999920',
      '99999999-9999-4999-8999-999999999903',
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
    const claimedWorkItem = await workRepository.claimNextPendingReservationRequest(createClaimInput('claim-confirm'));

    if (claimedWorkItem === null) {
      throw new Error('Expected pending request to be claimed');
    }

    const reservation = createReservation({
      id: createReservationId('99999999-9999-4999-8999-999999999921'),
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
        attempt: {
          reservationRequestId: claimedWorkItem.reservationRequest.id,
          sequence: claimedWorkItem.sequence,
          startedAt: '2026-06-01T08:59:59.000Z',
          completedAt: '2026-06-01T09:00:01.000Z',
          outcome: 'confirmed',
          reservationId: reservation.id,
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'confirmed',
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999920',
        status: ReservationRequestStatus.CONFIRMED,
      },
    });
    await expect(
      repository.findReservationRequestById(createReservationRequestId('99999999-9999-4999-8999-999999999920')),
    ).resolves.toMatchObject({
      status: ReservationRequestStatus.CONFIRMED,
    });
    await expect(
      repository.findReservationById(createReservationId('99999999-9999-4999-8999-999999999921')),
    ).resolves.toMatchObject({
      reservationRequestId: '99999999-9999-4999-8999-999999999920',
      seatIds: ['99999999-9999-4999-8999-999999999903'],
    });
    await expect(
      workRepository.findReservationRequestProcessingAttemptsByRequestId(
        createReservationRequestId('99999999-9999-4999-8999-999999999920'),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: 'confirmed',
        reservationId: '99999999-9999-4999-8999-999999999921',
      }),
    ]);
  });
});

function createTestReservationRequest(id: string, seatId: string) {
  return createReservationRequest({
    id: createReservationRequestId(id),
    movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
    screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
    seatIds: [createSeatId(seatId)],
    requestedByUserId: createUserId('user-1'),
  });
}

function createClaimInput(
  claimToken: string,
  claimedAt = '2026-06-01T08:59:00.000Z',
  options: {
    readonly maxLeaseTimeouts?: number;
    readonly maxTransientFailures?: number;
  } = {},
) {
  return {
    workerId: 'test-worker',
    claimToken,
    claimedAt,
    claimExpiresAt: addMilliseconds(claimedAt, 30_000),
    maxLeaseTimeouts: options.maxLeaseTimeouts ?? 3,
    maxTransientFailures: options.maxTransientFailures ?? 3,
  };
}

function addMilliseconds(isoString: string, milliseconds: number): string {
  return new Date(new Date(isoString).getTime() + milliseconds).toISOString();
}
