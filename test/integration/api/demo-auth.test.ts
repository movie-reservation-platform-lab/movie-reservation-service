import type { INestApplication } from '@nestjs/common';
import Ajv from 'ajv';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../src/app';
import type { AuthenticationAuditEvent } from '../../../src/application/audit/authentication-audit-event';
import type { AuditEventSink } from '../../../src/application/audit/ports/audit-event-sink';
import type { DemoLoginResult } from '../../../src/application/authentication/demo-login.service';
import { RequestAuthenticationAuditRecorder } from '../../../src/infrastructure/audit/request-authentication-audit-recorder';
import type { ApplicationLogger } from '../../../src/infrastructure/observability/application-logger';
import schema from '../../fixtures/audit/platform-audit-event-v1.schema.json';

const validate = new Ajv({ strict: false }).compile(schema);
const username = 'test-only-demo-user';
const password = 'test-only-demo-password';
const anyString: unknown = expect.any(String);

describe('opt-in demo credential check over HTTP', () => {
  let app: INestApplication;
  let disabledApp: INestApplication;
  let jwtApp: INestApplication;
  const events: AuthenticationAuditEvent[] = [];
  const logger = { info: vi.fn<ApplicationLogger['info']>(), error: vi.fn<ApplicationLogger['error']>() };
  const sink: AuditEventSink = {
    emit(event) {
      events.push(event);
      return { accepted: true };
    },
  };
  const recorder = new RequestAuthenticationAuditRecorder(
    {
      serviceName: 'movie-reservation-service',
      serviceVersion: 'test-build',
      environment: 'test',
    },
    sink,
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
    events.length = 0;
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
    expect(events).toHaveLength(1);
    expect(validate(events[0])).toBe(true);
    expect(events[0]).toMatchObject({
      metadata: { uid: body.audit_event_id, correlation_uid: 'demo-action-1' },
      user: { name: 'unknown', type_id: 0 },
      status_id: 2,
      unmapped: { platform: { request_id: 'request-1', aws_alb_trace_id: 'Root=1-6a9dd271-0123456789abcdef01234567' } },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'audit.authentication',
      expect.objectContaining({ audit_event_id: body.audit_event_id }),
    );
    expect(JSON.stringify(events)).not.toContain('private-submitted-username');
    expect(JSON.stringify(events)).not.toContain('private-wrong-password');
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
    expect(events[0]?.status_id).toBe(1);
    expect(events[0]?.metadata.uid).toBe(response.body.audit_event_id);
    expect(validate(events[0])).toBe(true);
    expect(JSON.stringify(events)).not.toContain(password);
    expect(JSON.stringify(events)).not.toContain(username);
  });

  it.each(['buffer_full', 'write_failed', 'throw'] as const)(
    'returns redacted 503 instead of authenticating when local audit output reports %s',
    async (failure) => {
      const unavailable = vi.spyOn(sink, 'emit').mockImplementationOnce(() => {
        if (failure === 'throw') {
          throw new Error('private stdout failure detail');
        }
        return { accepted: false, reason: failure };
      });

      try {
        const response = await request(app.getHttpServer()).post('/demo/auth/login').send({ username, password });
        expect(response.status).toBe(503);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toEqual({ authenticated: false, message: 'Audit emission unavailable' });
        expect(events).toHaveLength(0);
        expect(logger.info).not.toHaveBeenCalled();
      } finally {
        unavailable.mockRestore();
      }
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
    expect(events).toHaveLength(1);
    expect(events[0]?.status_detail).toBe(reason);
  });

  it('rejects syntactically invalid JSON before the credential check without copying the body to audit', async () => {
    const response = await request(app.getHttpServer())
      .post('/demo/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"do-not-log",');
    expect(response.status).toBe(400);
    expect(events).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('do-not-log');
  });

  it('does not register a login route when disabled', async () => {
    const response = await request(disabledApp.getHttpServer()).post('/demo/auth/login').send({ username, password });
    expect(response.status).toBe(404);
    expect(events).toHaveLength(0);
  });

  it('keeps the existing fixed-user GraphQL path working', async () => {
    const response = await request(app.getHttpServer()).post('/graphql').send({ query: '{ me { userId } }' });
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it('audits existing JWT-profile rejection without changing the GraphQL error contract', async () => {
    const response = await request(jwtApp.getHttpServer())
      .post('/graphql')
      .set('Authorization', 'Bearer private-malformed-token')
      .send({ query: '{ me { userId } }' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ statusCode: 401, message: 'Unauthenticated' });
    expect(events).toHaveLength(1);
    expect(events[0]?.unmapped.platform).toMatchObject({ route: '/graphql', auth_boundary: 'graphql' });
    expect(events[0]?.user).toEqual({ name: 'unknown', type_id: 0 });
    expect(JSON.stringify(events)).not.toContain('private-malformed-token');
  });

  it('preserves the GraphQL 401 rejection even when local audit output is unavailable', async () => {
    const unavailable = vi.spyOn(sink, 'emit').mockReturnValueOnce({ accepted: false, reason: 'buffer_full' });
    try {
      const response = await request(jwtApp.getHttpServer()).post('/graphql').send({ query: '{ me { userId } }' });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ statusCode: 401, message: 'Unauthenticated' });
      expect(events).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith('audit.emit.failed', { audit_event_id: anyString });
    } finally {
      unavailable.mockRestore();
    }
  });
});
