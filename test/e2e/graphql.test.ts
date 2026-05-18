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

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'none', typ: 'JWT' };
  return [
    encodeBase64UrlJson(header),
    encodeBase64UrlJson(payload),
    'local-signature',
  ].join('.');
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
