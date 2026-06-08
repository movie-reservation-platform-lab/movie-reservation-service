import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ReservationRequestProcessor } from '../../../src/application/movie-reservations/ports/reservation-request-processor';
import { createApp } from '../../../src/app';
import { RESERVATION_REQUEST_PROCESSOR } from '../../../src/di/movie-reservations/movie-reservation.tokens';
import type { LogFields } from '../../../src/infrastructure/observability/application-logger';
import type { GraphqlOperationLogger } from '../../../src/presentation/graphql/plugins/graphql-operation-logging.plugin';

interface CapturedGraphqlLogEntry {
  readonly event: string;
  readonly fields?: LogFields;
  readonly error?: unknown;
}

interface CapturedGraphqlLogMessages {
  readonly logMessages: CapturedGraphqlLogEntry[];
  readonly errorMessages: CapturedGraphqlLogEntry[];
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
    const response = await request(app.getHttpServer()).get('/graphql').set('accept', 'text/html');

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
          movie_provider_id: '11111111-1111-4111-8111-111111111111',
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
      movieProviderId: '11111111-1111-4111-8111-111111111111',
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
      movieProviderId: '11111111-1111-4111-8111-111111111111',
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

  it('echoes correlation and request ids on GraphQL responses', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('X-Correlation-Id', 'graphql-correlation-id')
      .set('X-Request-Id', 'graphql-request-id')
      .send({
        query: `{
          me {
            userId
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.headers['x-correlation-id']).toBe('graphql-correlation-id');
    expect(response.headers['x-request-id']).toBe('graphql-request-id');
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
    expect(capturedLogs.logMessages.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(['graphql.operation.start', 'graphql.operation.finish']),
    );

    const startLog = requireCapturedLog(capturedLogs.logMessages, 'graphql.operation.start');

    expect(startLog.fields).toMatchObject({
      graphql_operation_name: 'CurrentUser',
      graphql_operation_type: 'query',
      business_operation: 'me',
      movie_provider_code: 'aurora-silver-maple',
      user_id: 'local-dev-user',
    });
    expect(startLog.fields).not.toHaveProperty('movie_provider_id');
    expect(startLog.fields).not.toHaveProperty('request_id');
    expect(startLog.fields).not.toHaveProperty('http_method');
    expect(startLog.fields).not.toHaveProperty('http_route');
  });

  it('logs operation failure with GraphQL error details', async () => {
    capturedLogs.clear();

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `mutation DuplicateReservation {
          requestReservation(
            input: {
              screeningId: "55555555-5555-4555-8555-555555555551"
              seatIds: ["66666666-6666-4666-8666-666666666663", "66666666-6666-4666-8666-666666666663"]
            }
          ) {
            id
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    const failureLog = requireCapturedLog(capturedLogs.errorMessages, 'graphql.operation.failure');

    expect(failureLog.fields).toMatchObject({
      graphql_operation_name: 'DuplicateReservation',
      graphql_operation_type: 'mutation',
      business_operation: 'requestReservation',
      error_count: 1,
      error_types: ['Error'],
      error_messages: ['ReservationRequest cannot include duplicate seats'],
    });
    expect(failureLog.error).toBeInstanceOf(Error);
  });
});

describe('movie reservation GraphQL operation logging with local-jwt auth', () => {
  let app: INestApplication;
  const capturedLogs = createCapturedGraphqlLogger();

  beforeAll(async () => {
    app = await createApp({
      authMode: 'local-jwt',
      graphqlOperationLogger: capturedLogs.logger,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sanitizes auth-derived metadata before writing operation logs', async () => {
    capturedLogs.clear();

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set(
        'authorization',
        `Bearer ${createUnsignedJwt({
          sub: 'user-ada\nmovieProviderCode=forged',
          preferred_username: 'ada',
          email: 'ada@aurora.example.test',
          movie_provider_id: '11111111-1111-4111-8111-111111111111',
          movie_provider_code: 'aurora-silver-maple',
          realm_access: { roles: ['CUSTOMER'] },
          scope: 'reservations:read',
        })}`,
      )
      .send({
        query: `query CurrentUser {
          me {
            userId
          }
        }`,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();

    const startLog = requireCapturedLog(capturedLogs.logMessages, 'graphql.operation.start');

    expect(startLog.fields).toMatchObject({
      movie_provider_code: 'aurora-silver-maple',
      user_id: 'user-ada_movieProviderCode:forged',
    });
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
        id: '44444444-4444-4444-8444-444444444441',
        title: 'The Type-Safe Matinee',
        rating: 'PG',
        durationMinutes: 102,
      },
      {
        id: '44444444-4444-4444-8444-444444444442',
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
          screenings(movieId: "44444444-4444-4444-8444-444444444441") {
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
        id: '55555555-5555-4555-8555-555555555551',
        movieId: '44444444-4444-4444-8444-444444444441',
        auditoriumId: '33333333-3333-4333-8333-333333333331',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:42:00.000Z',
        seats: [
          { id: '66666666-6666-4666-8666-666666666661', row: 'A', number: 1 },
          { id: '66666666-6666-4666-8666-666666666662', row: 'A', number: 2 },
          { id: '66666666-6666-4666-8666-666666666663', row: 'A', number: 3 },
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
            screeningId: '55555555-5555-4555-8555-555555555551',
            seatIds: ['66666666-6666-4666-8666-666666666663'],
          },
        },
      });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.errors).toBeUndefined();
    expect(createResponse.body.data.requestReservation).toMatchObject({
      screeningId: '55555555-5555-4555-8555-555555555551',
      seatIds: ['66666666-6666-4666-8666-666666666663'],
      requestedByUserId: 'local-dev-user',
      status: 'REQUESTED',
    });

    const reservationRequestId = readCreatedReservationRequestId(createResponse.body as unknown);

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
      screeningId: '55555555-5555-4555-8555-555555555551',
      seatIds: ['66666666-6666-4666-8666-666666666663'],
      requestedByUserId: 'local-dev-user',
      status: 'REQUESTED',
    });

    // TODO: Replace this direct processor call once a real worker or processor
    //  trigger exists. D5 calls the processor through DI so the GraphQL polling
    //  flow stays deterministic without adding timers or queues.
    const processor = app.get<ReservationRequestProcessor>(RESERVATION_REQUEST_PROCESSOR);

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
      screeningId: '55555555-5555-4555-8555-555555555551',
      seatIds: ['66666666-6666-4666-8666-666666666663'],
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
    const reservationResult = readReservationResult(reservationResultResponse.body as unknown);

    expect(reservationResult.id).toEqual(expect.any(String));
    expect(reservationResult).toMatchObject({
      reservationRequestId,
      screeningId: '55555555-5555-4555-8555-555555555551',
      seatIds: ['66666666-6666-4666-8666-666666666663'],
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
            screeningId: '55555555-5555-4555-8555-555555555551',
            seatIds: ['66666666-6666-4666-8666-666666666663', '66666666-6666-4666-8666-666666666663'],
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
          reservationResult(requestId: "77777777-7777-4777-8777-777777777771") {
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
      id: '88888888-8888-4888-8888-888888888881',
      reservationRequestId: '77777777-7777-4777-8777-777777777771',
      screeningId: '55555555-5555-4555-8555-555555555551',
      seatIds: ['66666666-6666-4666-8666-666666666661', '66666666-6666-4666-8666-666666666662'],
      reservedByUserId: 'user-ada',
      confirmedAt: '2026-06-01T09:05:00.000Z',
    });
  });
});

describe('movie reservation fake worker with local-fixed-user auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({
      authMode: 'local-fixed-user',
      reservationWorkerMode: 'fake-in-process',
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('processes an async reservation request without a direct test processor call', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `mutation RequestReservation($input: RequestReservationInput!) {
          requestReservation(input: $input) {
            id
            status
          }
        }`,
        variables: {
          input: {
            screeningId: '55555555-5555-4555-8555-555555555551',
            seatIds: ['66666666-6666-4666-8666-666666666663'],
          },
        },
      });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.errors).toBeUndefined();
    const reservationRequestId = readCreatedReservationRequestId(createResponse.body as unknown);

    await expect(waitForReservationRequestStatus(app, reservationRequestId, 'CONFIRMED')).resolves.toMatchObject({
      id: reservationRequestId,
      status: 'CONFIRMED',
    });
  });
});

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'none', typ: 'JWT' };
  return [encodeBase64UrlJson(header), encodeBase64UrlJson(payload), 'local-signature'].join('.');
}

function createCapturedGraphqlLogger(): CapturedGraphqlLogMessages & {
  readonly logger: GraphqlOperationLogger;
  clear(): void;
} {
  const logMessages: CapturedGraphqlLogEntry[] = [];
  const errorMessages: CapturedGraphqlLogEntry[] = [];

  return {
    logMessages,
    errorMessages,
    logger: {
      debug(event: string, fields?: LogFields): void {
        logMessages.push(createCapturedLogEntry(event, fields));
      },
      info(event: string, fields?: LogFields): void {
        logMessages.push(createCapturedLogEntry(event, fields));
      },
      warn(event: string, fields?: LogFields): void {
        logMessages.push(createCapturedLogEntry(event, fields));
      },
      error(event: string, fields?: LogFields, error?: unknown): void {
        errorMessages.push(createCapturedLogEntry(event, fields, error));
      },
    },
    clear(): void {
      logMessages.length = 0;
      errorMessages.length = 0;
    },
  };
}

function createCapturedLogEntry(event: string, fields?: LogFields, error?: unknown): CapturedGraphqlLogEntry {
  return {
    event,
    ...(fields === undefined ? {} : { fields }),
    ...(error === undefined ? {} : { error }),
  };
}

function requireCapturedLog(logs: readonly CapturedGraphqlLogEntry[], event: string): CapturedGraphqlLogEntry {
  const log = logs.find((entry) => entry.event === event);

  if (log === undefined) {
    throw new Error(`Expected captured log event ${event}`);
  }

  return log;
}

function readCreatedReservationRequestId(body: unknown): string {
  const bodyRecord = requireRecord(body, 'GraphQL response body');
  const dataRecord = requireRecord(bodyRecord.data, 'GraphQL response data');
  const requestRecord = requireRecord(dataRecord.requestReservation, 'requestReservation payload');

  if (typeof requestRecord.id !== 'string') {
    throw new Error('requestReservation payload did not include a string id');
  }

  return requestRecord.id;
}

function readReservationResult(body: unknown): Record<string, unknown> {
  const bodyRecord = requireRecord(body, 'GraphQL response body');
  const dataRecord = requireRecord(bodyRecord.data, 'GraphQL response data');

  return requireRecord(dataRecord.reservationResult, 'reservationResult payload');
}

async function waitForReservationRequestStatus(
  app: INestApplication,
  reservationRequestId: string,
  expectedStatus: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2_000;
  return pollReservationRequestStatus(app, reservationRequestId, expectedStatus, deadline);
}

async function pollReservationRequestStatus(
  app: INestApplication,
  reservationRequestId: string,
  expectedStatus: string,
  deadline: number,
): Promise<Record<string, unknown>> {
  const response = await request(app.getHttpServer())
    .post('/graphql')
    .send({
      query: `query ReservationRequestStatus($id: ID!) {
          reservationRequestStatus(id: $id) {
            id
            status
          }
        }`,
      variables: {
        id: reservationRequestId,
      },
    });

  expect(response.status).toBe(200);
  expect(response.body.errors).toBeUndefined();

  const status = requireRecord(
    requireRecord(response.body.data, 'GraphQL response data').reservationRequestStatus,
    'reservationRequestStatus payload',
  );

  if (status.status === expectedStatus) {
    return status;
  }

  if (Date.now() < deadline) {
    await delay(50);
    return pollReservationRequestStatus(app, reservationRequestId, expectedStatus, deadline);
  }

  throw new Error(`Reservation request ${reservationRequestId} did not reach ${expectedStatus}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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
