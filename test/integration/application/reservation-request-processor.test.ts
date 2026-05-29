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
      id: 'request-first',
      seatIds: ['seat-a1'],
    });
    const secondRequest = createRequestedReservationRequest({
      id: 'request-second',
      seatIds: ['seat-a2'],
    });
    const store = createStore({
      reservationRequests: [firstRequest, secondRequest],
    });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['reservation-first'],
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
        id: 'request-first',
        status: ReservationRequestStatus.CONFIRMED,
      },
      reservation: {
        id: 'reservation-first',
        reservationRequestId: 'request-first',
        seatIds: ['seat-a1'],
        confirmedAt: '2026-06-01T09:00:01.000Z',
      },
      attempt: {
        reservationRequestId: 'request-first',
        sequence: 1,
        startedAt: '2026-06-01T09:00:00.000Z',
        completedAt: '2026-06-01T09:00:02.000Z',
        outcome: 'confirmed',
        reservationId: 'reservation-first',
      },
    });
    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('request-second'),
      ),
    ).resolves.toMatchObject({
      id: 'request-second',
      status: ReservationRequestStatus.REQUESTED,
    });
    await expect(
      workRepository.findReservationRequestProcessingAttemptsByRequestId(
        createReservationRequestId('request-first'),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: 'confirmed',
        reservationId: 'reservation-first',
        sequence: 1,
      }),
    ]);
  });

  it('rejects the whole claimed request when any requested seat conflicts', async () => {
    const conflictingReservation = createReservation({
      id: createReservationId('reservation-existing'),
      movieProviderId: createMovieProviderId('provider-1'),
      reservationRequestId: createReservationRequestId('request-existing'),
      screeningId: createScreeningId('screening-1'),
      seatIds: [createSeatId('seat-a1')],
      reservedByUserId: createUserId('user-existing'),
      confirmedAt: '2026-06-01T08:59:00.000Z',
    });
    const pendingRequest = createRequestedReservationRequest({
      id: 'request-conflicting',
      seatIds: ['seat-a1', 'seat-a2'],
    });
    const store = createStore({
      reservationRequests: [pendingRequest],
      reservations: [conflictingReservation],
    });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['reservation-unused'],
      clockInstants: ['2026-06-01T09:00:00.000Z', '2026-06-01T09:00:01.000Z'],
    });

    const actualResult = await processor.processNextPendingRequest();

    expect(actualResult).toMatchObject({
      outcome: 'rejected',
      reason: 'seat-conflict',
      reservationRequest: {
        id: 'request-conflicting',
        status: ReservationRequestStatus.REJECTED,
      },
      attempt: {
        reservationRequestId: 'request-conflicting',
        sequence: 1,
        outcome: 'rejected',
        reason: 'seat-conflict',
        conflictingReservationId: 'reservation-existing',
      },
    });
    await expect(
      repository.findReservationById(createReservationId('reservation-unused')),
    ).resolves.toBeNull();
  });

  it('returns no-pending-request without recording an attempt when only terminal requests exist', async () => {
    const terminalRequest = confirmReservationRequest(
      startProcessingReservationRequest(
        createRequestedReservationRequest({
          id: 'request-terminal',
          seatIds: ['seat-a1'],
        }),
      ),
    );
    const store = createStore({ reservationRequests: [terminalRequest] });
    const workRepository = new InMemoryReservationRequestWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['reservation-unused'],
      clockInstants: ['2026-06-01T09:00:00.000Z'],
    });

    await expect(processor.processNextPendingRequest()).resolves.toEqual({
      outcome: 'no-pending-request',
    });
    await expect(
      workRepository.findReservationRequestProcessingAttemptsByRequestId(
        createReservationRequestId('request-terminal'),
      ),
    ).resolves.toEqual([]);
  });

  it('marks a claimed request as failed when processing fails after claim', async () => {
    const pendingRequest = createRequestedReservationRequest({
      id: 'request-fails-after-claim',
      seatIds: ['seat-a1'],
    });
    const store = createStore({ reservationRequests: [pendingRequest] });
    const repository = new InMemoryMovieReservationRepository(store);
    const workRepository = new ThrowingConflictLookupWorkRepository(store);
    const processor = createProcessor({
      workRepository,
      reservationIds: ['reservation-unused'],
      clockInstants: ['2026-06-01T09:00:00.000Z', '2026-06-01T09:00:01.000Z'],
    });

    const actualResult = await processor.processNextPendingRequest();

    expect(actualResult).toMatchObject({
      outcome: 'failed',
      reason: 'unexpected-error',
      reservationRequest: {
        id: 'request-fails-after-claim',
        status: ReservationRequestStatus.FAILED,
      },
      attempt: {
        reservationRequestId: 'request-fails-after-claim',
        sequence: 1,
        outcome: 'failed',
        reason: 'unexpected-error',
      },
    });
    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('request-fails-after-claim'),
      ),
    ).resolves.toMatchObject({
      status: ReservationRequestStatus.FAILED,
    });
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
}): InProcessReservationRequestProcessor {
  return new InProcessReservationRequestProcessor(
    input.workRepository,
    new StubReservationIdGenerator(input.reservationIds),
    new SequenceClock(input.clockInstants),
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
    movieProviderId: createMovieProviderId('provider-1'),
    screeningId: createScreeningId('screening-1'),
    seatIds: input.seatIds.map(createSeatId),
    requestedByUserId: createUserId('user-1'),
  });
}
