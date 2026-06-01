import { describe, expect, it } from 'vitest';

import { InProcessReservationRequestProcessor } from '../../../src/application/movie-reservations/in-process-reservation-request-processor';
import type { Clock } from '../../../src/application/movie-reservations/ports/clock';
import type { ReservationIdGenerator } from '../../../src/application/movie-reservations/ports/reservation-id-generator';
import type { ReservationRequestWorkRepository } from '../../../src/application/movie-reservations/ports/reservation-request-work-repository';
import { createUserId } from '../../../src/domain/authentication/user-id';
import { createMovieProviderId } from '../../../src/domain/movie-reservations/movie-provider-id';
import { createReservation } from '../../../src/domain/movie-reservations/reservation';
import {
  createReservationRequest,
  type ReservationRequest,
} from '../../../src/domain/movie-reservations/reservation-request';
import { createReservationId } from '../../../src/domain/movie-reservations/reservation-id';
import { createReservationRequestId } from '../../../src/domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../../src/domain/movie-reservations/reservation-request-status';
import {
  confirmReservationRequest,
  startProcessingReservationRequest,
} from '../../../src/domain/movie-reservations/reservation-request-transitions';
import { createScreeningId } from '../../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../../src/domain/movie-reservations/seat-id';
import { InMemoryMovieReservationRepository } from '../../../src/infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';
import { InMemoryMovieReservationStore } from '../../../src/infrastructure/repositories/in-memory/in-memory-movie-reservation.store';
import { InMemoryReservationRequestWorkRepository } from '../../../src/infrastructure/repositories/in-memory/in-memory-reservation-request-work.repository';

describe('InProcessReservationRequestProcessor', () => {
  it('claims the lowest-sequence pending request and confirms it', async () => {
    const firstRequest = createRequestedReservationRequest({
      id: '99999999-9999-4999-8999-999999999911',
      seatIds: ['99999999-9999-4999-8999-999999999903'],
    });
    const secondRequest = createRequestedReservationRequest({
      id: '99999999-9999-4999-8999-999999999912',
      seatIds: ['99999999-9999-4999-8999-999999999904'],
    });
    const store = createStore({
      reservationRequests: [firstRequest, secondRequest],
    });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['99999999-9999-4999-8999-999999999913'],
      clockInstants: [
        '2026-06-01T09:00:00.000Z',
        '2026-06-01T09:00:01.000Z',
        '2026-06-01T09:00:02.000Z',
      ],
    });

    const actualResult = await processor.processNextPendingRequest();

    expect(actualResult).toMatchObject({
      outcome: 'confirmed',
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999911',
        status: ReservationRequestStatus.CONFIRMED,
      },
      reservation: {
        id: '99999999-9999-4999-8999-999999999913',
        reservationRequestId: '99999999-9999-4999-8999-999999999911',
        seatIds: ['99999999-9999-4999-8999-999999999903'],
        confirmedAt: '2026-06-01T09:00:01.000Z',
      },
      attempt: {
        reservationRequestId: '99999999-9999-4999-8999-999999999911',
        sequence: 1,
        startedAt: '2026-06-01T09:00:00.000Z',
        completedAt: '2026-06-01T09:00:02.000Z',
        outcome: 'confirmed',
        reservationId: '99999999-9999-4999-8999-999999999913',
      },
    });
    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('99999999-9999-4999-8999-999999999912'),
      ),
    ).resolves.toMatchObject({
      id: '99999999-9999-4999-8999-999999999912',
      status: ReservationRequestStatus.REQUESTED,
    });
    await expect(
      workRepository.findReservationRequestProcessingAttemptsByRequestId(
        createReservationRequestId('99999999-9999-4999-8999-999999999911'),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: 'confirmed',
        reservationId: '99999999-9999-4999-8999-999999999913',
        sequence: 1,
      }),
    ]);
  });

  it('rejects the whole claimed request when any requested seat conflicts', async () => {
    const conflictingReservation = createReservation({
      id: createReservationId('99999999-9999-4999-8999-999999999914'),
      movieProviderId: createMovieProviderId(
        '99999999-9999-4999-8999-999999999901',
      ),
      reservationRequestId: createReservationRequestId(
        '99999999-9999-4999-8999-999999999915',
      ),
      screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
      seatIds: [createSeatId('99999999-9999-4999-8999-999999999903')],
      reservedByUserId: createUserId('user-existing'),
      confirmedAt: '2026-06-01T08:59:00.000Z',
    });
    const pendingRequest = createRequestedReservationRequest({
      id: '99999999-9999-4999-8999-999999999916',
      seatIds: [
        '99999999-9999-4999-8999-999999999903',
        '99999999-9999-4999-8999-999999999904',
      ],
    });
    const store = createStore({
      reservationRequests: [pendingRequest],
      reservations: [conflictingReservation],
    });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['99999999-9999-4999-8999-999999999917'],
      clockInstants: ['2026-06-01T09:00:00.000Z', '2026-06-01T09:00:01.000Z'],
    });

    const actualResult = await processor.processNextPendingRequest();

    expect(actualResult).toMatchObject({
      outcome: 'rejected',
      reason: 'seat-conflict',
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999916',
        status: ReservationRequestStatus.REJECTED,
      },
      attempt: {
        reservationRequestId: '99999999-9999-4999-8999-999999999916',
        sequence: 1,
        outcome: 'rejected',
        reason: 'seat-conflict',
        conflictingReservationId: '99999999-9999-4999-8999-999999999914',
      },
    });
    await expect(
      repository.findReservationById(
        createReservationId('99999999-9999-4999-8999-999999999917'),
      ),
    ).resolves.toBeNull();
  });

  it('returns no-pending-request without recording an attempt when only terminal requests exist', async () => {
    const terminalRequest = confirmReservationRequest(
      startProcessingReservationRequest(
        createRequestedReservationRequest({
          id: '99999999-9999-4999-8999-999999999918',
          seatIds: ['99999999-9999-4999-8999-999999999903'],
        }),
      ),
    );
    const store = createStore({ reservationRequests: [terminalRequest] });
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['99999999-9999-4999-8999-999999999917'],
      clockInstants: ['2026-06-01T09:00:00.000Z'],
    });

    await expect(processor.processNextPendingRequest()).resolves.toEqual({
      outcome: 'no-pending-request',
    });
    await expect(
      workRepository.findReservationRequestProcessingAttemptsByRequestId(
        createReservationRequestId('99999999-9999-4999-8999-999999999918'),
      ),
    ).resolves.toEqual([]);
  });

  it('marks a claimed request as failed when the final attempt fails after claim', async () => {
    const pendingRequest = createRequestedReservationRequest({
      id: '99999999-9999-4999-8999-999999999919',
      seatIds: ['99999999-9999-4999-8999-999999999903'],
    });
    const store = createStore({ reservationRequests: [pendingRequest] });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new ThrowingConflictLookupWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['99999999-9999-4999-8999-999999999917'],
      clockInstants: ['2026-06-01T09:00:00.000Z', '2026-06-01T09:00:01.000Z'],
      maxTransientFailures: 1,
    });

    const actualResult = await processor.processNextPendingRequest();

    expect(actualResult).toMatchObject({
      outcome: 'failed',
      reason: 'unexpected-error',
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999919',
        status: ReservationRequestStatus.FAILED,
      },
      attempt: {
        reservationRequestId: '99999999-9999-4999-8999-999999999919',
        sequence: 1,
        outcome: 'failed',
        reason: 'unexpected-error',
      },
    });
    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('99999999-9999-4999-8999-999999999919'),
      ),
    ).resolves.toMatchObject({
      status: ReservationRequestStatus.FAILED,
    });
  });

  it('records unexpected failures as retryable until max transient failures is reached', async () => {
    const pendingRequest = createRequestedReservationRequest({
      id: '99999999-9999-4999-8999-999999999925',
      seatIds: ['99999999-9999-4999-8999-999999999903'],
    });
    const store = createStore({ reservationRequests: [pendingRequest] });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new ThrowingConflictLookupWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: [],
      clockInstants: [
        '2026-06-01T09:00:00.000Z',
        '2026-06-01T09:00:01.000Z',
        '2026-06-01T09:00:02.000Z',
        '2026-06-01T09:00:03.000Z',
      ],
      maxTransientFailures: 2,
    });

    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'retryable-failure',
      attemptsRemaining: 1,
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999925',
        status: ReservationRequestStatus.REQUESTED,
      },
      attempt: {
        sequence: 1,
        outcome: 'failed',
        reason: 'unexpected-error',
      },
    });
    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'failed',
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999925',
        status: ReservationRequestStatus.FAILED,
      },
      attempt: {
        sequence: 1,
        outcome: 'failed',
        reason: 'unexpected-error',
      },
    });
    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('99999999-9999-4999-8999-999999999925'),
      ),
    ).resolves.toMatchObject({
      status: ReservationRequestStatus.FAILED,
    });
    await expect(
      workRepository.findReservationRequestProcessingAttemptsByRequestId(
        createReservationRequestId('99999999-9999-4999-8999-999999999925'),
      ),
    ).resolves.toHaveLength(2);
  });
});

/**
 * Work repository test double that keeps real in-memory behavior but forces
 * the conflict lookup step to fail after a request has already been claimed.
 */
class ThrowingConflictLookupWorkRepository extends InMemoryReservationRequestWorkRepository {
  override async findConflictingConfirmedReservation(): Promise<null> {
    throw new Error('simulated conflict lookup failure');
  }
}

/**
 * Reservation id generator that returns predefined ids in order so confirmed
 * reservation results can be asserted deterministically.
 */
class StubReservationIdGenerator implements ReservationIdGenerator {
  private readonly reservationIds: string[];

  constructor(reservationIds: readonly string[]) {
    this.reservationIds = [...reservationIds];
  }

  generateReservationId() {
    const reservationId = this.reservationIds.shift();

    if (reservationId === undefined) {
      throw new Error('StubReservationIdGenerator has no reservation ids left');
    }

    return createReservationId(reservationId);
  }
}

/**
 * Test clock that returns predefined instants in order so processor timestamps
 * can be asserted without depending on wall-clock time.
 */
class SequenceClock implements Clock {
  private readonly instants: string[];

  constructor(instants: readonly string[]) {
    this.instants = [...instants];
  }

  nowIsoString(): string {
    const instant = this.instants.shift();

    if (instant === undefined) {
      throw new Error('SequenceClock has no instants left');
    }

    return instant;
  }
}

/**
 * Builds the real processor with deterministic test adapters for generated ids
 * and timestamps.
 */
function createProcessor(input: {
  readonly workRepository: ReservationRequestWorkRepository;
  readonly reservationIds: readonly string[];
  readonly clockInstants: readonly string[];
  readonly maxTransientFailures?: number;
}): InProcessReservationRequestProcessor {
  return new InProcessReservationRequestProcessor(
    input.workRepository,
    new StubReservationIdGenerator(input.reservationIds),
    new SequenceClock(input.clockInstants),
    {
      workerId: 'test-worker',
      claimLeaseMs: 30_000,
      maxLeaseTimeouts: 3,
      maxTransientFailures: input.maxTransientFailures ?? 3,
      createClaimToken: () => 'test-claim-token',
    },
  );
}

/**
 * Creates the shared in-memory store used by both customer-facing and
 * worker-facing repositories in these application workflow tests.
 */
function createStore(
  input: {
    readonly reservationRequests?: readonly ReservationRequest[];
    readonly reservations?: readonly ReturnType<typeof createReservation>[];
  } = {},
): InMemoryMovieReservationStore {
  return new InMemoryMovieReservationStore({
    movieProviders: [],
    auditoriums: [],
    movies: [],
    screenings: [],
    seats: [],
    reservationRequests: input.reservationRequests ?? [],
    reservations: input.reservations ?? [],
  });
}

/**
 * Creates a valid REQUESTED reservation request with common provider,
 * screening, and user ids so individual tests only vary the request id/seats.
 */
function createRequestedReservationRequest(input: {
  readonly id: string;
  readonly seatIds: readonly string[];
}): ReservationRequest {
  return createReservationRequest({
    id: createReservationRequestId(input.id),
    movieProviderId: createMovieProviderId(
      '99999999-9999-4999-8999-999999999901',
    ),
    screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
    seatIds: input.seatIds.map(createSeatId),
    requestedByUserId: createUserId('user-1'),
  });
}
