import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ReservationRequestProcessor } from '../../../src/application/movie-reservations/ports/reservation-request-processor';
import { createApp } from '../../../src/app';
import { RESERVATION_REQUEST_PROCESSOR } from '../../../src/di/movie-reservations/movie-reservation.tokens';
import type { GraphqlOperationLogger } from '../../../src/presentation/graphql/plugins/graphql-operation-logging.plugin';

interface CapturedGraphqlLogMessages {
  readonly logMessages: string[];
  readonly errorMessages: string[];
  readonly errorTraces: string[];
}

describe('movie reservation GraphQL auth context with local-jwt auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ authMode: 'local-jwt' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves GraphiQL without requiring a bearer token for the initial HTML page', async () => {
    const response = await request(app.getHttpServer())
      .get('/graphql')
      .set('accept', 'text/html');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>GraphiQL</title>');
    expect(response.text).toContain('GraphiQL.createFetcher');
  });

  it('returns authenticated bearer-token claims through me', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set(
        'authorization',
        `Bearer ${createUnsignedJwt({
          sub: 'user-ada',
          preferred_username: 'ada',
          email: 'ada@aurora.example.test',
          movie_provider_id: 'provider-aurora',
          realm_access: { roles: ['CUSTOMER'] },
          scope: 'reservations:read',
        })}`,
      )
      .send({
        query: `{
          me {
            userId
            username
            email
            movieProviderId
            roles
            scopes
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.me).toEqual({
      userId: 'user-ada',
      username: 'ada',
      email: 'ada@aurora.example.test',
      movieProviderId: 'provider-aurora',
      roles: ['CUSTOMER'],
      scopes: ['reservations:read'],
    });
  });

  it('rejects GraphQL requests without a bearer token before resolver execution', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `{
          me {
            userId
          }
        }`,
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      statusCode: 401,
      message: 'Unauthenticated',
    });
  });
});

describe('movie reservation GraphQL auth context with local-fixed-user auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ authMode: 'local-fixed-user' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the configured local development user without a caller-provided token', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `{
          me {
            userId
            username
            email
            movieProviderId
            roles
            scopes
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.me).toEqual({
      userId: 'local-dev-user',
      username: 'local-dev-admin',
      email: 'local-dev@example.test',
      movieProviderId: 'provider-aurora',
      roles: ['TENANT_ADMIN'],
      scopes: ['reservations:read:tenant'],
    });
  });

  it('accepts arbitrary bearer tokens while using the fixed local identity', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('authorization', 'Bearer anything-local')
      .send({
        query: `{
          me {
            userId
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.me).toEqual({
      userId: 'local-dev-user',
    });
  });
});

describe('movie reservation GraphQL operation logging', () => {
  let app: INestApplication;
  const capturedLogs = createCapturedGraphqlLogger();

  beforeAll(async () => {
    app = await createApp({
      authMode: 'local-fixed-user',
      graphqlOperationLogger: capturedLogs.logger,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * TODO: These assertions intentionally check formatted log strings, which is
   * brittle and not production-shaped. Rework them during the observability
   * deliverable when Pino/structured logging replaces ad hoc key-value strings.
   */
  it('logs operation start and finish with request identity context', async () => {
    capturedLogs.clear();

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query CurrentUser {
          me {
            userId
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(capturedLogs.logMessages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('event=graphql.operation.start'),
        expect.stringContaining('event=graphql.operation.finish'),
      ]),
    );
    expect(capturedLogs.logMessages.join('\n')).toContain(
      'operationName=CurrentUser',
    );
    expect(capturedLogs.logMessages.join('\n')).toContain(
      'operationType=query',
    );
    expect(capturedLogs.logMessages.join('\n')).toContain(
      'movieProviderId=provider-aurora',
    );
    expect(capturedLogs.logMessages.join('\n')).toContain(
      'userId=local-dev-user',
    );
  });

  it('logs operation failure with GraphQL error details', async () => {
    capturedLogs.clear();

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `mutation DuplicateReservation {
          requestReservation(
            input: {
              screeningId: "screening-aurora-1"
              seatIds: ["seat-aurora-1-a3", "seat-aurora-1-a3"]
            }
          ) {
            id
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(capturedLogs.errorMessages.join('\n')).toContain(
      'event=graphql.operation.failure',
    );
    expect(capturedLogs.errorMessages.join('\n')).toContain(
      'operationName=DuplicateReservation',
    );
    expect(capturedLogs.errorMessages.join('\n')).toContain('errorCount=1');
    expect(capturedLogs.errorMessages.join('\n')).toContain(
      'errorTypes="Error"',
    );
    expect(capturedLogs.errorMessages.join('\n')).toContain(
      'ReservationRequest cannot include duplicate seats',
    );
    expect(capturedLogs.errorTraces.join('\n')).toContain(
      'Error: ReservationRequest cannot include duplicate seats',
    );
  });
});

describe('movie reservation GraphQL polling API with local-fixed-user auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ authMode: 'local-fixed-user' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // TODO: Add owner-only and cross-provider authorization cases for the D4
  // reservation queries. Tracked in docs/plans/service-follow-up-tasks.md.
  it('lists movies for the authenticated actor movie provider', async () => {
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
    expect(response.body.data.movies).toEqual([
      {
        id: 'movie-aurora-1',
        title: 'The Type-Safe Matinee',
        rating: 'PG',
        durationMinutes: 102,
      },
      {
        id: 'movie-aurora-2',
        title: 'Fargate at Midnight',
        rating: 'PG-13',
        durationMinutes: 118,
      },
    ]);
  });

  it('lists screenings with seats for the authenticated actor movie provider', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `{
          screenings(movieId: "movie-aurora-1") {
            id
            movieId
            auditoriumId
            startsAt
            endsAt
            seats {
              id
              row
              number
            }
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.screenings).toEqual([
      {
        id: 'screening-aurora-1',
        movieId: 'movie-aurora-1',
        auditoriumId: 'auditorium-aurora-main',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:42:00.000Z',
        seats: [
          { id: 'seat-aurora-1-a1', row: 'A', number: 1 },
          { id: 'seat-aurora-1-a2', row: 'A', number: 2 },
          { id: 'seat-aurora-1-a3', row: 'A', number: 3 },
        ],
      },
    ]);
  });

  it('creates a reservation request and lets the client poll it by id', async () => {
    const createResponse = await request(app.getHttpServer())
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
            screeningId: 'screening-aurora-1',
            seatIds: ['seat-aurora-1-a3'],
          },
        },
      });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.errors).toBeUndefined();
    expect(createResponse.body.data.requestReservation).toMatchObject({
      screeningId: 'screening-aurora-1',
      seatIds: ['seat-aurora-1-a3'],
      requestedByUserId: 'local-dev-user',
      status: 'REQUESTED',
    });

    const reservationRequestId = readCreatedReservationRequestId(
      createResponse.body as unknown,
    );

    expect(reservationRequestId).toEqual(expect.any(String));

    const pollResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query ReservationRequestStatus($id: ID!) {
          reservationRequestStatus(id: $id) {
            id
            screeningId
            seatIds
            requestedByUserId
            status
          }
        }`,
        variables: {
          id: reservationRequestId,
        },
      });

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.errors).toBeUndefined();
    expect(pollResponse.body.data.reservationRequestStatus).toEqual({
      id: reservationRequestId,
      screeningId: 'screening-aurora-1',
      seatIds: ['seat-aurora-1-a3'],
      requestedByUserId: 'local-dev-user',
      status: 'REQUESTED',
    });

    // TODO: Replace this direct processor call once a real worker or processor
    //  trigger exists. D5 calls the processor through DI so the GraphQL polling
    //  flow stays deterministic without adding timers or queues.
    const processor = app.get<ReservationRequestProcessor>(
      RESERVATION_REQUEST_PROCESSOR,
    );

    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'confirmed',
      reservationRequest: {
        id: reservationRequestId,
        status: 'CONFIRMED',
      },
    });

    const confirmedPollResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query ReservationRequestStatus($id: ID!) {
          reservationRequestStatus(id: $id) {
            id
            screeningId
            seatIds
            requestedByUserId
            status
          }
        }`,
        variables: {
          id: reservationRequestId,
        },
      });

    expect(confirmedPollResponse.status).toBe(200);
    expect(confirmedPollResponse.body.errors).toBeUndefined();
    expect(confirmedPollResponse.body.data.reservationRequestStatus).toEqual({
      id: reservationRequestId,
      screeningId: 'screening-aurora-1',
      seatIds: ['seat-aurora-1-a3'],
      requestedByUserId: 'local-dev-user',
      status: 'CONFIRMED',
    });

    const reservationResultResponse = await request(app.getHttpServer())
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
        variables: {
          requestId: reservationRequestId,
        },
      });

    expect(reservationResultResponse.status).toBe(200);
    expect(reservationResultResponse.body.errors).toBeUndefined();
    const reservationResult = readReservationResult(
      reservationResultResponse.body as unknown,
    );

    expect(reservationResult.id).toEqual(expect.any(String));
    expect(reservationResult).toMatchObject({
      reservationRequestId,
      screeningId: 'screening-aurora-1',
      seatIds: ['seat-aurora-1-a3'],
      reservedByUserId: 'local-dev-user',
    });
    expect(reservationResult.confirmedAt).toEqual(expect.any(String));
  });

  it('rejects duplicate seat ids when requesting a reservation', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `mutation RequestReservation($input: RequestReservationInput!) {
          requestReservation(input: $input) {
            id
          }
        }`,
        variables: {
          input: {
            screeningId: 'screening-aurora-1',
            seatIds: ['seat-aurora-1-a3', 'seat-aurora-1-a3'],
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'ReservationRequest cannot include duplicate seats',
        }),
      ]),
    );
  });

  it('returns an authorized reservation result by reservation request id', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `{
          reservationResult(requestId: "request-aurora-ada") {
            id
            reservationRequestId
            screeningId
            seatIds
            reservedByUserId
            confirmedAt
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.reservationResult).toEqual({
      id: 'reservation-aurora-ada',
      reservationRequestId: 'request-aurora-ada',
      screeningId: 'screening-aurora-1',
      seatIds: ['seat-aurora-1-a1', 'seat-aurora-1-a2'],
      reservedByUserId: 'user-ada',
      confirmedAt: '2026-06-01T09:05:00.000Z',
    });
  });
});

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'none', typ: 'JWT' };
  return [
    encodeBase64UrlJson(header),
    encodeBase64UrlJson(payload),
    'local-signature',
  ].join('.');
}

function createCapturedGraphqlLogger(): CapturedGraphqlLogMessages & {
  readonly logger: GraphqlOperationLogger;
  clear(): void;
} {
  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  const errorTraces: string[] = [];

  return {
    logMessages,
    errorMessages,
    errorTraces,
    logger: {
      log(message: string): void {
        logMessages.push(message);
      },
      error(message: string, trace?: string): void {
        errorMessages.push(message);
        if (trace !== undefined) {
          errorTraces.push(trace);
        }
      },
    },
    clear(): void {
      logMessages.length = 0;
      errorMessages.length = 0;
      errorTraces.length = 0;
    },
  };
}

function readCreatedReservationRequestId(body: unknown): string {
  const bodyRecord = requireRecord(body, 'GraphQL response body');
  const dataRecord = requireRecord(bodyRecord.data, 'GraphQL response data');
  const requestRecord = requireRecord(
    dataRecord.requestReservation,
    'requestReservation payload',
  );

  if (typeof requestRecord.id !== 'string') {
    throw new Error('requestReservation payload did not include a string id');
  }

  return requestRecord.id;
}

function readReservationResult(body: unknown): Record<string, unknown> {
  const bodyRecord = requireRecord(body, 'GraphQL response body');
  const dataRecord = requireRecord(bodyRecord.data, 'GraphQL response data');

  return requireRecord(
    dataRecord.reservationResult,
    'reservationResult payload',
  );
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} was not an object`);
  }

  return value as Record<string, unknown>;
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
