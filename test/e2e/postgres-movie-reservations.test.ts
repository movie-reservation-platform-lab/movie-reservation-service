import type { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import knexFactory, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ReservationRequestAlreadyExistsError } from '../../src/application/movie-reservations/errors/reservation-request-already-exists-error';
import type { MovieReservationRepository } from '../../src/application/movie-reservations/ports/movie-reservation-repository';
import type { ReservationRequestProcessor } from '../../src/application/movie-reservations/ports/reservation-request-processor';
import type { ReservationRequestWorkRepository } from '../../src/application/movie-reservations/ports/reservation-request-work-repository';
import { createUserId } from '../../src/domain/authentication/user-id';
import { createReservation } from '../../src/domain/movie-reservations/reservation';
import { createReservationId } from '../../src/domain/movie-reservations/reservation-id';
import { createReservationRequest } from '../../src/domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../src/domain/movie-reservations/reservation-request-id';
import { createMovieProviderId } from '../../src/domain/movie-reservations/movie-provider-id';
import { createScreeningId } from '../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../src/domain/movie-reservations/seat-id';
import {
  MOVIE_RESERVATION_REPOSITORY,
  RESERVATION_REQUEST_PROCESSOR,
  RESERVATION_REQUEST_WORK_REPOSITORY,
} from '../../src/di/movie-reservations/movie-reservation.tokens';
import { MOVIE_RESERVATION_DEMO_IDS } from '../../src/infrastructure/fixtures/movie-reservations/movie-reservation-demo-data';

describe('Postgres-backed movie reservation workflow', () => {
  let app: INestApplication;
  let database: Knex;
  let container: StartedPostgreSqlContainer | undefined;

  beforeAll(async () => {
    const databaseUrl = await createDatabaseUrl();
    process.env.NODE_ENV = 'test';
    process.env.COMPOSITION_PROFILE = 'local-postgres';
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_POOL_MIN = '0';
    process.env.DATABASE_POOL_MAX = '5';
    process.env.RESERVATION_WORKER_MODE = 'disabled';

    const [{ createApp }, { createKnexConfig }, { seedLocalMovieReservationCatalog }] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/infrastructure/database/knex-config.js'),
      import('../../src/infrastructure/database/seed-local.js'),
    ]);

    database = knexFactory(
      createKnexConfig({
        databaseUrl,
        poolMin: 0,
        poolMax: 5,
      }),
    );
    app = await createApp({
      authMode: 'local-fixed-user',
      persistenceMode: 'postgres',
      reservationWorkerMode: 'disabled',
    });
    await app.init();

    async function resetAndSeedDatabase(): Promise<void> {
      await resetDatabase(database);
      await database.migrate.latest();
      await seedLocalMovieReservationCatalog(database);
    }

    await resetAndSeedDatabase();
  }, 120_000);

  beforeEach(async () => {
    const { seedLocalMovieReservationCatalog } = await import('../../src/infrastructure/database/seed-local.js');
    await resetDatabase(database);
    await database.migrate.latest();
    await seedLocalMovieReservationCatalog(database);
  });

  afterAll(async () => {
    await app?.close();
    await database?.destroy();
    await container?.stop();
  });

  /**
   * Scenario:
   * - Starts the full Nest GraphQL app with the Postgres repository wired in.
   * - Seeds demo data for multiple movie providers.
   * - Verifies the local fixed Aurora actor only reads Aurora catalog rows.
   */
  it('reads the seeded Aurora catalog through GraphQL', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `{
          movies {
            id
            title
            rating
            durationMinutes
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.movies).toEqual(
      expect.arrayContaining([
        {
          id: MOVIE_RESERVATION_DEMO_IDS.movies.auroraShawshankRedemption,
          title: 'The Shawshank Redemption',
          rating: 'R',
          durationMinutes: 142,
        },
        {
          id: MOVIE_RESERVATION_DEMO_IDS.movies.auroraMatrix,
          title: 'The Matrix',
          rating: 'R',
          durationMinutes: 136,
        },
        {
          id: MOVIE_RESERVATION_DEMO_IDS.movies.auroraTypeSafeMatinee,
          title: 'The Type-Safe Matinee',
          rating: 'PG',
          durationMinutes: 102,
        },
      ]),
    );
    expect(response.body.data.movies).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'The Last Deployment' })]),
    );
  });

  /**
   * Scenario:
   * - Reuses an existing seeded reservation request id.
   * - Calls the repository directly to hit the Postgres unique constraint.
   * - Verifies the adapter translates that database error into the application
   *   duplicate-request error.
   */
  it('maps duplicate reservation request ids to the application error', async () => {
    const repository = app.get<MovieReservationRepository>(MOVIE_RESERVATION_REPOSITORY);
    const duplicateReservationRequest = createReservationRequest({
      id: createReservationRequestId(MOVIE_RESERVATION_DEMO_IDS.reservationRequests.auroraAda),
      movieProviderId: createMovieProviderId(MOVIE_RESERVATION_DEMO_IDS.providers.aurora),
      screeningId: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning),
      seatIds: [createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3)],
      requestedByUserId: createUserId('local-dev-user'),
    });

    await expect(repository.saveReservationRequest(duplicateReservationRequest)).rejects.toThrow(
      ReservationRequestAlreadyExistsError,
    );
    await expect(repository.saveReservationRequest(duplicateReservationRequest)).rejects.toThrow(
      `Reservation request ${MOVIE_RESERVATION_DEMO_IDS.reservationRequests.auroraAda} already exists`,
    );
  });

  /**
   * Scenario:
   * - Saves a reservation request through the customer-facing Postgres
   *   repository with async observability handoff metadata.
   * - Claims the same request through the worker-facing Postgres repository.
   * - Verifies the persisted context is returned with the claimed work item so
   *   the worker can continue trace/log correlation later.
   */
  it('persists observability context for claimed reservation work', async () => {
    const repository = app.get<MovieReservationRepository>(MOVIE_RESERVATION_REPOSITORY);
    const workRepository = app.get<ReservationRequestWorkRepository>(RESERVATION_REQUEST_WORK_REPOSITORY);
    const reservationRequest = createReservationRequest({
      id: createReservationRequestId('99999999-9999-4999-8999-999999999935'),
      movieProviderId: createMovieProviderId(MOVIE_RESERVATION_DEMO_IDS.providers.aurora),
      screeningId: createScreeningId(MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning),
      seatIds: [createSeatId(MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3)],
      requestedByUserId: createUserId('local-dev-user'),
    });
    const observabilityContext = {
      correlationId: 'postgres-correlation-id',
      requestId: 'postgres-request-id',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tracestate: 'vendor=value',
    };

    await repository.saveReservationRequest(reservationRequest, observabilityContext);

    await expect(
      workRepository.claimNextPendingReservationRequest(createClaimInput('claim-observability-context')),
    ).resolves.toMatchObject({
      reservationRequest: {
        id: '99999999-9999-4999-8999-999999999935',
      },
      observabilityContext,
    });
  });

  /**
   * Scenario:
   * - Creates a reservation request through GraphQL.
   * - Uses a Nest app with the background worker disabled, so the test drives
   *   exactly one processor pass instead of racing the fake poll loop.
   * - Runs one manual processor pass against the Postgres work repository.
   * - Reads the request status and final reservation back through GraphQL.
   */
  it('creates, processes, and reads a confirmed reservation', async () => {
    const reservationRequest = await requestReservation([MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3]);

    const processor = app.get<ReservationRequestProcessor>(RESERVATION_REQUEST_PROCESSOR);
    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'confirmed',
      reservationRequest: {
        id: reservationRequest.id,
        status: 'CONFIRMED',
      },
    });

    await expect(readReservationRequestStatus(reservationRequest.id)).resolves.toMatchObject({
      id: reservationRequest.id,
      status: 'CONFIRMED',
    });
    await expect(readReservationResult(reservationRequest.id)).resolves.toMatchObject({
      reservationRequestId: reservationRequest.id,
      screeningId: MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning,
      seatIds: [MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3],
      reservedByUserId: 'local-dev-user',
    });
  });

  /**
   * Scenario:
   * - Creates two pending requests for the same screening seat.
   * - Processes the first request into a confirmed reservation.
   * - Processes the second request and verifies the business-level seat
   *   conflict rejection.
   */
  it('rejects the second request for an already confirmed seat', async () => {
    const firstRequest = await requestReservation([MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3]);
    const secondRequest = await requestReservation([MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3]);
    const processor = app.get<ReservationRequestProcessor>(RESERVATION_REQUEST_PROCESSOR);

    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'confirmed',
      reservationRequest: {
        id: firstRequest.id,
        status: 'CONFIRMED',
      },
    });
    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'rejected',
      reason: 'seat-conflict',
      reservationRequest: {
        id: secondRequest.id,
        status: 'REJECTED',
      },
    });

    await expect(readReservationRequestStatus(firstRequest.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    await expect(readReservationRequestStatus(secondRequest.id)).resolves.toMatchObject({
      status: 'REJECTED',
    });
  });

  /**
   * Scenario:
   * - Claims two requests for the same seat before either one is confirmed.
   * - Confirms the first claim, causing Postgres to reserve the seat.
   * - Confirms the second claim and verifies the database unique violation is
   *   translated into the same application-level seat-conflict rejection.
   */
  it('maps a database confirmed-seat unique race to a rejected request', async () => {
    await requestReservation([MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3]);
    await requestReservation([MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3]);
    const workRepository = app.get<ReservationRequestWorkRepository>(RESERVATION_REQUEST_WORK_REPOSITORY);
    const firstClaim = await workRepository.claimNextPendingReservationRequest(createClaimInput('claim-one'));
    const secondClaim = await workRepository.claimNextPendingReservationRequest(createClaimInput('claim-two'));

    if (firstClaim === null || secondClaim === null) {
      throw new Error('Expected both reservation requests to be claimed');
    }

    const firstReservation = createReservation({
      id: createReservationId('99999999-9999-4999-8999-999999999931'),
      movieProviderId: firstClaim.reservationRequest.movieProviderId,
      reservationRequestId: firstClaim.reservationRequest.id,
      screeningId: firstClaim.reservationRequest.screeningId,
      seatIds: firstClaim.reservationRequest.seatIds,
      reservedByUserId: firstClaim.reservationRequest.requestedByUserId,
      confirmedAt: '2026-06-01T09:00:00.000Z',
    });
    const secondReservation = createReservation({
      id: createReservationId('99999999-9999-4999-8999-999999999932'),
      movieProviderId: secondClaim.reservationRequest.movieProviderId,
      reservationRequestId: secondClaim.reservationRequest.id,
      screeningId: secondClaim.reservationRequest.screeningId,
      seatIds: secondClaim.reservationRequest.seatIds,
      reservedByUserId: secondClaim.reservationRequest.requestedByUserId,
      confirmedAt: '2026-06-01T09:00:01.000Z',
    });

    await expect(
      workRepository.confirmClaimedReservationRequest({
        claimedWorkItem: firstClaim,
        reservation: firstReservation,
        attempt: {
          reservationRequestId: firstClaim.reservationRequest.id,
          sequence: firstClaim.sequence,
          startedAt: '2026-06-01T08:59:59.000Z',
          completedAt: '2026-06-01T09:00:02.000Z',
          outcome: 'confirmed',
          reservationId: firstReservation.id,
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'confirmed',
      reservationRequest: {
        id: firstClaim.reservationRequest.id,
        status: 'CONFIRMED',
      },
    });
    await expect(
      workRepository.confirmClaimedReservationRequest({
        claimedWorkItem: secondClaim,
        reservation: secondReservation,
        attempt: {
          reservationRequestId: secondClaim.reservationRequest.id,
          sequence: secondClaim.sequence,
          startedAt: '2026-06-01T09:00:00.000Z',
          completedAt: '2026-06-01T09:00:03.000Z',
          outcome: 'confirmed',
          reservationId: secondReservation.id,
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'rejected',
      reservationRequest: {
        id: secondClaim.reservationRequest.id,
        status: 'REJECTED',
      },
      attempt: {
        outcome: 'rejected',
        reason: 'seat-conflict',
        conflictingReservationId: firstReservation.id,
      },
    });
  });

  /**
   * Scenario:
   * - Claims a pending request and leaves it in PROCESSING.
   * - Verifies it cannot be reclaimed before the lease expires.
   * - Reclaims it after expiry and verifies only the lease-timeout counter
   *   changes, not the transient-failure counter.
   */
  it('reclaims expired processing work without consuming transient failure budget', async () => {
    const reservationRequest = await requestReservation([MOVIE_RESERVATION_DEMO_IDS.seats.auroraA3]);
    const workRepository = app.get<ReservationRequestWorkRepository>(RESERVATION_REQUEST_WORK_REPOSITORY);
    const firstClaim = await workRepository.claimNextPendingReservationRequest(
      createClaimInput('claim-before-timeout', '2026-06-01T08:59:00.000Z'),
    );

    if (firstClaim === null) {
      throw new Error('Expected reservation request to be claimed');
    }

    await expect(
      workRepository.claimNextPendingReservationRequest(
        createClaimInput('claim-before-expiry', '2026-06-01T08:59:20.000Z'),
      ),
    ).resolves.toBeNull();

    await expect(
      workRepository.claimNextPendingReservationRequest(
        createClaimInput('claim-after-expiry', '2026-06-01T08:59:31.000Z'),
      ),
    ).resolves.toMatchObject({
      reservationRequest: {
        id: reservationRequest.id,
        status: 'PROCESSING',
      },
      leaseTimeoutCount: 1,
      transientFailureCount: 0,
      claimToken: 'claim-after-expiry',
    });
  });

  /**
   * Scenario:
   * - Inserts a screening that mixes Aurora provider data with a Riverton movie.
   * - Verifies Postgres rejects cross-provider catalog relationships.
   */
  it('enforces provider consistency for screening catalog rows', async () => {
    await expect(
      database('screenings').insert({
        id: '99999999-9999-4999-8999-999999999933',
        movie_provider_id: MOVIE_RESERVATION_DEMO_IDS.providers.aurora,
        movie_id: MOVIE_RESERVATION_DEMO_IDS.movies.rivertonLastDeployment,
        auditorium_id: MOVIE_RESERVATION_DEMO_IDS.auditoriums.auroraMain,
        starts_at: '2026-06-03T09:00:00.000Z',
        ends_at: '2026-06-03T10:36:00.000Z',
      }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  /**
   * Scenario:
   * - Inserts a reservation request seat row with a Riverton seat on an Aurora
   *   screening.
   * - Verifies the relational invariant rejects seats outside the screening
   *   auditorium.
   */
  it('enforces that requested seats belong to the request screening auditorium', async () => {
    await expect(
      database('reservation_request_seats').insert({
        reservation_request_id: MOVIE_RESERVATION_DEMO_IDS.reservationRequests.auroraAda,
        movie_provider_id: MOVIE_RESERVATION_DEMO_IDS.providers.aurora,
        screening_id: MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning,
        auditorium_id: MOVIE_RESERVATION_DEMO_IDS.auditoriums.auroraMain,
        seat_id: MOVIE_RESERVATION_DEMO_IDS.seats.rivertonB3,
      }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  /**
   * Scenario:
   * - Inserts a confirmed reservation seat row with a Riverton seat on an
   *   Aurora reservation.
   * - Verifies confirmed reservations have the same auditorium/provider guard
   *   as reservation requests.
   */
  it('enforces that confirmed seats belong to the reservation screening auditorium', async () => {
    await expect(
      database('reservation_seats').insert({
        reservation_id: MOVIE_RESERVATION_DEMO_IDS.reservations.auroraAda,
        movie_provider_id: MOVIE_RESERVATION_DEMO_IDS.providers.aurora,
        screening_id: MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning,
        auditorium_id: MOVIE_RESERVATION_DEMO_IDS.auditoriums.auroraMain,
        seat_id: MOVIE_RESERVATION_DEMO_IDS.seats.rivertonB3,
      }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  /**
   * Sends the public GraphQL mutation used by clients to create a reservation
   * request for the seeded Aurora screening.
   */
  async function requestReservation(seatIds: readonly string[]): Promise<{ readonly id: string }> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `mutation RequestReservation($input: RequestReservationInput!) {
          requestReservation(input: $input) {
            id
            screeningId
            seatIds
            requestedByUserId
            status
          }
        }`,
        variables: {
          input: {
            screeningId: MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning,
            seatIds,
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();

    return requireReservationRequestPayload(response.body.data.requestReservation, 'requestReservation payload');
  }

  /**
   * Reads the public GraphQL status projection for a reservation request.
   */
  async function readReservationRequestStatus(id: string): Promise<Record<string, unknown> | null> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query ReservationRequestStatus($id: ID!) {
          reservationRequestStatus(id: $id) {
            id
            status
          }
        }`,
        variables: { id },
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.reservationRequestStatus as Record<string, unknown> | null;
  }

  /**
   * Reads the public GraphQL reservation result projection after processing.
   */
  async function readReservationResult(requestId: string): Promise<Record<string, unknown> | null> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query ReservationResult($requestId: ID!) {
          reservationResult(requestId: $requestId) {
            id
            reservationRequestId
            screeningId
            seatIds
            reservedByUserId
            confirmedAt
          }
        }`,
        variables: { requestId },
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.reservationResult as Record<string, unknown> | null;
  }

  /**
   * Chooses the e2e database source.
   *
   * External mode lets local/debug runs point at a caller-provided Postgres
   * URL. The default path starts an isolated Testcontainers Postgres instance.
   */
  async function createDatabaseUrl(): Promise<string> {
    if (process.env.MOVIE_RESERVATION_E2E_DATABASE === 'external') {
      const externalDatabaseUrl = process.env.TEST_DATABASE_URL;

      if (externalDatabaseUrl === undefined || externalDatabaseUrl.length === 0) {
        throw new Error('TEST_DATABASE_URL is required when MOVIE_RESERVATION_E2E_DATABASE=external');
      }

      return externalDatabaseUrl;
    }

    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('movie_reservation_service')
      .withUsername('movie_reservation_service')
      .withPassword('movie_reservation_service')
      .start();

    return container.getConnectionUri();
  }
});

/**
 * Drops and recreates the public schema so every test starts from a clean
 * migrated database rather than leftover rows from a previous scenario.
 */
async function resetDatabase(database: Knex): Promise<void> {
  await database.raw('drop schema if exists public cascade');
  await database.raw('create schema public');
}

/**
 * Runtime-checks the GraphQL response shape before later test steps use the id.
 */
function requireReservationRequestPayload(value: unknown, name: string): { readonly id: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} was not an object`);
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string') {
    throw new Error(`${name}.id was not a string`);
  }

  return { id: record.id };
}

/**
 * Builds deterministic worker claim input for direct work-repository tests.
 */
function createClaimInput(claimToken: string, claimedAt = '2026-06-01T08:59:00.000Z') {
  return {
    workerId: 'postgres-e2e-worker',
    claimToken,
    claimedAt,
    claimExpiresAt: addMilliseconds(claimedAt, 30_000),
    maxLeaseTimeouts: 3,
    maxTransientFailures: 3,
  };
}

/**
 * Keeps lease timestamps readable in tests while still deriving exact ISO
 * expiry values.
 */
function addMilliseconds(isoString: string, milliseconds: number): string {
  return new Date(new Date(isoString).getTime() + milliseconds).toISOString();
}
