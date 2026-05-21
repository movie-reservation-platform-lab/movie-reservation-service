import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';

describe('movie reservation GraphQL auth context with local-jwt auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ authMode: 'local-jwt' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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
        query: `query ReservationRequestById($id: ID!) {
          reservationRequestById(id: $id) {
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
    expect(pollResponse.body.data.reservationRequestById).toEqual({
      id: reservationRequestId,
      screeningId: 'screening-aurora-1',
      seatIds: ['seat-aurora-1-a3'],
      requestedByUserId: 'local-dev-user',
      status: 'REQUESTED',
    });
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

  it('returns an authorized confirmed reservation by id', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `{
          reservation(id: "reservation-aurora-ada") {
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
    expect(response.body.data.reservation).toEqual({
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

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} was not an object`);
  }

  return value as Record<string, unknown>;
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
