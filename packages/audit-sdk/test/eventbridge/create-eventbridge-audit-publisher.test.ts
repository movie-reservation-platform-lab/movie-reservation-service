import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuditPublisherConfigurationError,
  createEventBridgeAuditClient,
  createEventBridgeAuditPublisher,
} from '../../src/eventbridge/index.js';
import { canonicalRejectedAuthenticationEvent } from '../../src/testing/index.js';

const eventBusArn = 'arn:aws:events:eu-central-1:123456789012:event-bus/central-audit';

describe('createEventBridgeAuditClient', () => {
  it('takes the Region from the bus ARN and makes one attempt per publish', async () => {
    const client = createEventBridgeAuditClient('arn:aws:events:us-west-2:123456789012:event-bus/central-audit');

    await expect(client.config.region()).resolves.toBe('us-west-2');
    await expect(client.config.maxAttempts()).resolves.toBe(1);
  });

  it('rejects a bus ARN without a Region', () => {
    expect(() => createEventBridgeAuditClient('central-audit')).toThrow(
      new AuditPublisherConfigurationError('eventBusArn'),
    );
  });
});

describe('createEventBridgeAuditPublisher', () => {
  it('still applies the publisher configuration checks', () => {
    expect(() =>
      createEventBridgeAuditPublisher({
        eventBusArn: 'arn:aws:events:eu-central-1:123456789012:rule/not-a-bus',
        timeoutMs: 1_000,
      }),
    ).toThrow(new AuditPublisherConfigurationError('eventBusArn'));
    expect(() => createEventBridgeAuditPublisher({ eventBusArn, timeoutMs: 0 })).toThrow(
      new AuditPublisherConfigurationError('timeoutMs'),
    );
  });

  describe('over HTTP against a local PutEvents stub', () => {
    let server: Server;
    let requests: { readonly target: string | undefined; readonly body: string }[];
    let respond: (res: ServerResponse) => void;

    beforeEach(async () => {
      requests = [];
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          requests.push({
            target: req.headers['x-amz-target'] as string | undefined,
            body: Buffer.concat(chunks).toString(),
          });
          respond(res);
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected a loopback listener');
      }
      // Real client, real signing and wire protocol; only the endpoint and credentials are local.
      vi.stubEnv('AWS_ENDPOINT_URL_EVENTBRIDGE', `http://127.0.0.1:${address.port}`);
      vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-access-key');
      vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret-key');
      vi.stubEnv('AWS_SESSION_TOKEN', '');
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      server.close();
      await once(server, 'close');
    });

    function reply(status: number, body: unknown): void {
      respond = (res) => {
        res.writeHead(status, { 'content-type': 'application/x-amz-json-1.1' });
        res.end(JSON.stringify(body));
      };
    }

    it('sends one PutEvents entry to the exact bus and returns acceptance', async () => {
      reply(200, { FailedEntryCount: 0, Entries: [{ EventId: 'transport-event-1' }] });

      const result = await createEventBridgeAuditPublisher({ eventBusArn, timeoutMs: 5_000 }).publish(
        canonicalRejectedAuthenticationEvent,
      );

      expect(result).toEqual({
        accepted: true,
        auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
        transportEventId: 'transport-event-1',
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.target).toBe('AWSEvents.PutEvents');
      const body = JSON.parse(requests[0]?.body ?? '{}') as { Entries: { EventBusName: string; Detail: string }[] };
      expect(body.Entries).toHaveLength(1);
      expect(body.Entries[0]?.EventBusName).toBe(eventBusArn);
      expect(JSON.parse(body.Entries[0]?.Detail ?? '{}')).toMatchObject({
        event: { metadata: { uid: canonicalRejectedAuthenticationEvent.metadata.uid } },
      });
    });

    it.each([
      [500, 'InternalException', 'unavailable'],
      [400, 'ThrottlingException', 'throttled'],
    ] as const)('does not retry a %i %s response and classifies it as %s', async (status, errorType, reason) => {
      reply(status, { __type: errorType, message: 'private detail' });

      const result = await createEventBridgeAuditPublisher({ eventBusArn, timeoutMs: 5_000 }).publish(
        canonicalRejectedAuthenticationEvent,
      );

      expect(result).toEqual({
        accepted: false,
        auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
        reason,
      });
      expect(requests).toHaveLength(1);
    });
  });
});
