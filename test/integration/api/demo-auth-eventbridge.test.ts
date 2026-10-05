import {
  EventBridgeAuditPublisher,
  type EventBridgeClientLike,
} from '@movie-reservation-platform-lab/audit-sdk/eventbridge';
import { FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { createAuditPublisher } from '../../../src/di/audit/create-audit-publisher';
import { RequestAuthenticationAuditRecorder } from '../../../src/infrastructure/audit/request-authentication-audit-recorder';

const username = 'test-only-demo-user';
const password = 'test-only-demo-password';
const eventBusArn = 'arn:aws:events:eu-central-1:222222222222:event-bus/movie-platform-audit';
const anyString: unknown = expect.any(String);

// Derived from the SDK port so the service never imports @aws-sdk/* directly.
type PutEventsCommandOutput = Awaited<ReturnType<EventBridgeClientLike['send']>>;
type ClientBehavior = (signal: AbortSignal | undefined) => Promise<PutEventsCommandOutput>;

const respond =
  (output: Partial<PutEventsCommandOutput>): ClientBehavior =>
  () =>
    Promise.resolve({ $metadata: {}, ...output });
const failWith =
  (name: string): ClientBehavior =>
  () =>
    Promise.reject(Object.assign(new Error('private AWS detail'), { name }));
const hang: ClientBehavior = (signal) =>
  new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));

/**
 * Roadmap §6.3 (fail open) through HTTP with the SDK EventBridge publisher; only the AWS client is fake.
 */
describe('demo login with the EventBridge audit publisher', () => {
  let app: INestApplication;
  let behavior: ClientBehavior;
  const client: EventBridgeClientLike = { send: (_command, options) => behavior(options?.abortSignal) };

  beforeAll(async () => {
    const publisher = createAuditPublisher(
      { publisher: 'eventbridge', eventBusArn, timeoutMs: 100, stdoutComparisonMirror: false },
      {
        stdout: new FakeAuditPublisher(),
        createEventBridge: (config) => new EventBridgeAuditPublisher(client, config),
      },
    );
    const recorder = new RequestAuthenticationAuditRecorder(
      { serviceName: 'movie-reservation-service', serviceVersion: 'test-build', environment: 'test' },
      publisher,
      { info: () => undefined, error: () => undefined },
    );
    app = await createApp({ demoAuth: { enabled: true, username, password }, authenticationAuditRecorder: recorder });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    behavior = respond({ FailedEntryCount: 0, Entries: [{ EventId: 'transport-event-1' }] });
  });

  it.each([
    ['accepted credentials', { username, password }, 200, true],
    ['rejected credentials', { username, password: 'wrong-password' }, 401, false],
  ] as const)('returns %s with a receipt when EventBridge accepts', async (_case, body, status, authenticated) => {
    const response = await request(app.getHttpServer()).post('/demo/auth/login').send(body);

    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ authenticated, request_id: anyString, audit_event_id: anyString });
  });

  describe.each([
    [
      'partial failure',
      respond({ FailedEntryCount: 1, Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'x' }] }),
    ],
    ['throttling', failWith('ThrottlingException')],
    ['access denied', failWith('AccessDeniedException')],
    ['timeout', hang],
  ] as const)('when EventBridge does not accept (%s)', (_failure, failingBehavior) => {
    beforeEach(() => {
      behavior = failingBehavior;
    });

    it('keeps accepted credentials at 200 without receipt fields (fail open)', async () => {
      const response = await request(app.getHttpServer()).post('/demo/auth/login').send({ username, password });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ authenticated: true, message: 'Demo credentials accepted' });
    });

    it('keeps rejected credentials at 401 without receipt fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/demo/auth/login')
        .send({ username, password: 'wrong-password' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ authenticated: false, message: 'Invalid credentials' });
    });
  });
});
