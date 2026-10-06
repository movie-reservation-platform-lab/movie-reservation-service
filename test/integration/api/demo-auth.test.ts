import { validateAuthenticationAuditEvent } from '@movie-reservation-platform-lab/audit-sdk/core';
import { FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../src/app';
import type { DemoLoginResult } from '../../../src/application/authentication/demo-login.service';
import { RequestAuthenticationAuditRecorder } from '../../../src/infrastructure/audit/request-authentication-audit-recorder';
import type { ApplicationLogger } from '../../../src/infrastructure/observability/application-logger';

const validate = (event: unknown): boolean => validateAuthenticationAuditEvent(event).valid;
const username = 'test-only-demo-user';
const password = 'test-only-demo-password';
const anyString: unknown = expect.any(String);

describe('opt-in demo credential check over HTTP', () => {
  let app: INestApplication;
  let disabledApp: INestApplication;
  let jwtApp: INestApplication;
  const publisher = new FakeAuditPublisher();
  const logger = { info: vi.fn<ApplicationLogger['info']>(), error: vi.fn<ApplicationLogger['error']>() };
  const recorder = new RequestAuthenticationAuditRecorder(
    {
      serviceName: 'movie-reservation-service',
      serviceVersion: 'test-build',
      environment: 'test',
    },
    publisher,
    logger,
  );

  beforeAll(async () => {
    app = await createApp({
      demoAuth: { enabled: true, username, password },
      authenticationAuditRecorder: recorder,
    });
    disabledApp = await createApp({ demoAuth: { enabled: false }, authenticationAuditRecorder: recorder });
    jwtApp = await createApp({ authMode: 'local-jwt', authenticationAuditRecorder: recorder });
    await Promise.all([app.init(), disabledApp.init(), jwtApp.init()]);
  });
  beforeEach(() => {
    publisher.reset();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await Promise.all([app.close(), disabledApp.close(), jwtApp.close()]);
  });

  it('rejects wrong credentials and links the response, event, logs and AWS ingress header', async () => {
    const response = await request(app.getHttpServer())
      .post('/demo/auth/login')
      .set('X-Request-Id', 'request-1')
      .set('X-Correlation-Id', 'demo-action-1')
      .set('X-Amzn-Trace-Id', 'Root=1-6a9dd271-0123456789abcdef01234567')
      .send({ username: 'private-submitted-username', password: 'private-wrong-password' });
    const body = response.body as DemoLoginResult;
    if (!('audit_event_id' in body)) {
      throw new Error('Expected rejected credentials to include an accepted audit receipt');
    }

    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      authenticated: false,
      message: 'Invalid credentials',
      request_id: 'request-1',
      audit_event_id: anyString,
    });
    expect(response.headers['x-request-id']).toBe('request-1');
    expect(response.headers['x-correlation-id']).toBe('demo-action-1');
    expect(publisher.publishedEvents).toHaveLength(1);
    expect(validate(publisher.publishedEvents[0])).toBe(true);
    expect(publisher.publishedEvents[0]).toMatchObject({
      metadata: { uid: body.audit_event_id, correlation_uid: 'demo-action-1' },
      user: { name: 'unknown', type_id: 0 },
      status_id: 2,
      unmapped: { platform: { request_id: 'request-1', aws_alb_trace_id: 'Root=1-6a9dd271-0123456789abcdef01234567' } },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'audit.authentication',
      expect.objectContaining({ audit_event_id: body.audit_event_id }),
    );
    expect(JSON.stringify(publisher.publishedEvents)).not.toContain('private-submitted-username');
    expect(JSON.stringify(publisher.publishedEvents)).not.toContain('private-wrong-password');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('private-');
  });

  it('accepts configured credentials but creates no session or token', async () => {
    const response = await request(app.getHttpServer()).post('/demo/auth/login').send({ username, password });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      authenticated: true,
      message: 'Demo credentials accepted',
      request_id: anyString,
      audit_event_id: anyString,
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(publisher.publishedEvents[0]?.status_id).toBe(1);
    expect(publisher.publishedEvents[0]?.metadata.uid).toBe(response.body.audit_event_id);
    expect(validate(publisher.publishedEvents[0])).toBe(true);
    expect(JSON.stringify(publisher.publishedEvents)).not.toContain(password);
    expect(JSON.stringify(publisher.publishedEvents)).not.toContain(username);
  });

  it.each([
    ['wrong password', { username, password: 'incorrect_nonexistent_password' }],
    ['missing password', { username }],
    ['malformed username', { username: 123, password }],
  ])('keeps %s rejected with 401 and no receipt when audit publishing is unavailable', async (_case, body) => {
    publisher.enqueue({ accepted: false, reason: 'unavailable' });

    const response = await request(app.getHttpServer()).post('/demo/auth/login').send(body);
    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    // toEqual pins absence: no receipt fields, not even undefined ones.
    expect(response.body).toEqual({ authenticated: false, message: 'Invalid credentials' });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'timeout', 'throw'] as const)(
    'fails open for accepted credentials when the audit publisher reports %s: 200 without a receipt',
    async (failure) => {
      if (failure === 'throw') {
        vi.spyOn(publisher, 'publish').mockRejectedValueOnce(new Error('private stdout failure detail'));
      } else {
        publisher.enqueue({ accepted: false, reason: failure });
      }

      const response = await request(app.getHttpServer()).post('/demo/auth/login').send({ username, password });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      // toEqual pins absence: no receipt fields for an event no publisher accepted.
      expect(response.body).toEqual({ authenticated: true, message: 'Demo credentials accepted' });
      expect(JSON.stringify(response.body)).not.toContain('private');
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'audit.emit.failed',
        expect.objectContaining({
          auth_boundary: 'demo_login',
          auth_status_id: 1,
          failure_reason: failure === 'throw' ? 'unavailable' : failure,
        }),
      );
    },
  );

  it.each([
    [{}, 'MISSING_CREDENTIALS'],
    [{ username }, 'MISSING_CREDENTIALS'],
    [{ username, password: '' }, 'MISSING_CREDENTIALS'],
    [{ username: 123, password }, 'MALFORMED_CREDENTIALS'],
    [{ username, password: { secret: true } }, 'MALFORMED_CREDENTIALS'],
    [{ username: 'x'.repeat(257), password }, 'MALFORMED_CREDENTIALS'],
    [{ username, password: 'x'.repeat(1025) }, 'MALFORMED_CREDENTIALS'],
    [[], 'MALFORMED_CREDENTIALS'],
    [{ username: 'unknown-user', password }, 'INVALID_CREDENTIALS'],
  ])('returns the same generic 401 for invalid credential input %#', async (body, reason) => {
    const response = await request(app.getHttpServer()).post('/demo/auth/login').send(body);
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid credentials');
    expect(publisher.publishedEvents).toHaveLength(1);
    expect(publisher.publishedEvents[0]?.status_detail).toBe(reason);
  });

  it('rejects syntactically invalid JSON before the credential check without copying the body to audit', async () => {
    const response = await request(app.getHttpServer())
      .post('/demo/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"do-not-log",');
    expect(response.status).toBe(400);
    expect(publisher.publishedEvents).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('do-not-log');
  });

  it('does not register a login route when disabled', async () => {
    const response = await request(disabledApp.getHttpServer()).post('/demo/auth/login').send({ username, password });
    expect(response.status).toBe(404);
    expect(publisher.publishedEvents).toHaveLength(0);
  });

  it('keeps the existing fixed-user GraphQL path working', async () => {
    const response = await request(app.getHttpServer()).post('/graphql').send({ query: '{ me { userId } }' });
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(publisher.publishedEvents).toHaveLength(0);
  });

  it('audits existing JWT-profile rejection without changing the GraphQL error contract', async () => {
    const response = await request(jwtApp.getHttpServer())
      .post('/graphql')
      .set('Authorization', 'Bearer private-malformed-token')
      .send({ query: '{ me { userId } }' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ statusCode: 401, message: 'Unauthenticated' });
    expect(publisher.publishedEvents).toHaveLength(1);
    expect(publisher.publishedEvents[0]?.unmapped.platform).toMatchObject({
      route: '/graphql',
      auth_boundary: 'graphql',
    });
    expect(publisher.publishedEvents[0]?.user).toEqual({ name: 'unknown', type_id: 0 });
    expect(JSON.stringify(publisher.publishedEvents)).not.toContain('private-malformed-token');
  });

  it('preserves the GraphQL 401 rejection even when the audit publisher is unavailable', async () => {
    publisher.enqueue({ accepted: false, reason: 'unavailable' });

    const response = await request(jwtApp.getHttpServer()).post('/graphql').send({ query: '{ me { userId } }' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ statusCode: 401, message: 'Unauthenticated' });
    expect(logger.error).toHaveBeenCalledWith(
      'audit.emit.failed',
      expect.objectContaining({
        audit_event_id: anyString,
        request_id: anyString,
        auth_boundary: 'graphql',
        auth_status_id: 2,
        failure_reason: 'unavailable',
      }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});
