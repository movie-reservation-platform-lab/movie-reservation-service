import { PutEventsCommand, type PutEventsCommandOutput } from '@aws-sdk/client-eventbridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditPublishResult, AuthenticationAuditEvent } from '../../src/core/index.js';
import {
  AUDIT_EVENTBRIDGE_DETAIL_TYPE,
  AUDIT_EVENTBRIDGE_ENVELOPE_VERSION,
  AUDIT_EVENTBRIDGE_SOURCE,
  AuditPublisherConfigurationError,
  EventBridgeAuditPublisher,
  type EventBridgeClientLike,
  type PutEventsResponseLike,
} from '../../src/eventbridge/index.js';
import { inspectPutEventsResponse } from '../../src/eventbridge/inspect-put-events-response.js';
import { canonicalRejectedAuthenticationEvent } from '../../src/testing/index.js';

const eventBusArn = 'arn:aws:events:eu-central-1:123456789012:event-bus/central-audit';

afterEach(() => vi.useRealTimers());

describe('EventBridgeAuditPublisher', () => {
  it('uses the exact configured bus ARN and package-owned envelope constants', async () => {
    let capturedCommand: PutEventsCommand | undefined;
    const client: EventBridgeClientLike = {
      send(command) {
        capturedCommand = command;
        return Promise.reject(new Error('private transport detail'));
      },
    };
    const publisher = new EventBridgeAuditPublisher(client, {
      eventBusArn,
      timeoutMs: 1_000,
      resources: ['arn:aws:ecs:eu-central-1:123456789012:service/demo/reservation'],
    });

    await expect(publisher.publish(canonicalRejectedAuthenticationEvent)).resolves.toEqual({
      accepted: false,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      reason: 'unavailable',
    });
    expect(capturedCommand).toBeInstanceOf(PutEventsCommand);
    expect(capturedCommand?.input).toEqual({
      Entries: [
        {
          Source: AUDIT_EVENTBRIDGE_SOURCE,
          DetailType: AUDIT_EVENTBRIDGE_DETAIL_TYPE,
          EventBusName: eventBusArn,
          Resources: ['arn:aws:ecs:eu-central-1:123456789012:service/demo/reservation'],
          Detail: JSON.stringify({
            envelope_version: AUDIT_EVENTBRIDGE_ENVELOPE_VERSION,
            event: canonicalRejectedAuthenticationEvent,
          }),
        },
      ],
    });
  });

  it('returns transport-neutral acceptance for a fully accepted EventBridge entry', async () => {
    const client: EventBridgeClientLike = {
      send: () =>
        Promise.resolve({
          FailedEntryCount: 0,
          Entries: [{ EventId: 'transport-1' }],
          $metadata: {},
        }),
    };
    const result = await new EventBridgeAuditPublisher(client, { eventBusArn, timeoutMs: 1_000 }).publish(
      canonicalRejectedAuthenticationEvent,
    );
    expect(result).toEqual({
      accepted: true,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      transportEventId: 'transport-1',
    });
  });

  it('uses the package-owned source assigned to the event service', async () => {
    let capturedCommand: PutEventsCommand | undefined;
    const client: EventBridgeClientLike = {
      send(command) {
        capturedCommand = command;
        return Promise.resolve({ FailedEntryCount: 0, Entries: [{ EventId: 'transport-1' }], $metadata: {} });
      },
    };
    const agentEvent: AuthenticationAuditEvent = {
      ...canonicalRejectedAuthenticationEvent,
      metadata: {
        ...canonicalRejectedAuthenticationEvent.metadata,
        product: { ...canonicalRejectedAuthenticationEvent.metadata.product, name: 'movie-reservation-agent' },
      },
      service: { ...canonicalRejectedAuthenticationEvent.service, name: 'movie-reservation-agent' },
    };

    await new EventBridgeAuditPublisher(client, { eventBusArn, timeoutMs: 1_000 }).publish(agentEvent);

    expect(capturedCommand?.input.Entries?.[0]?.Source).toBe('movie-platform.reservation-agent.audit');
  });

  it('rejects non-ARN bus names so publication cannot silently target a default or ambiguous bus', () => {
    const client = { send: vi.fn<EventBridgeClientLike['send']>() };
    const construct = () => new EventBridgeAuditPublisher(client, { eventBusArn: 'central-audit', timeoutMs: 1_000 });
    expect(construct).toThrow(AuditPublisherConfigurationError);
    expect(construct).toThrow(
      expect.objectContaining({ name: 'AuditPublisherConfigurationError', field: 'eventBusArn' }),
    );
  });

  it.each([
    [{ name: 'ThrottlingException', message: 'private quota detail' }, 'throttled'],
    [{ name: 'AccessDeniedException', message: 'private policy detail' }, 'configuration'],
    [{ name: 'InternalFailure', message: 'private AWS detail' }, 'unavailable'],
  ] as const)('maps %s to a bounded result without leaking AWS details', async (transportError, reason) => {
    const error = Object.assign(new Error(transportError.message), { name: transportError.name });
    const client: EventBridgeClientLike = { send: () => Promise.reject(error) };
    const result = await new EventBridgeAuditPublisher(client, { eventBusArn, timeoutMs: 1_000 }).publish(
      canonicalRejectedAuthenticationEvent,
    );
    expect(result).toEqual({
      accepted: false,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      reason,
    });
    expect(JSON.stringify(result)).not.toContain(transportError.message);
    expect(JSON.stringify(result)).not.toContain(transportError.name);
  });

  it('returns timeout when the configured bound aborts the AWS request', async () => {
    vi.useFakeTimers();
    const publisher = new EventBridgeAuditPublisher(abortableClient(), { eventBusArn, timeoutMs: 25 });
    const resultPromise = publisher.publish(canonicalRejectedAuthenticationEvent);
    await vi.advanceTimersByTimeAsync(25);
    await expect(resultPromise).resolves.toEqual({
      accepted: false,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      reason: 'timeout',
    });
  });

  it('returns at the configured timeout even when the transport ignores abort', async () => {
    vi.useFakeTimers();
    const client: EventBridgeClientLike = { send: () => new Promise(() => undefined) };
    const resultPromise = new EventBridgeAuditPublisher(client, { eventBusArn, timeoutMs: 25 }).publish(
      canonicalRejectedAuthenticationEvent,
    );
    await vi.advanceTimersByTimeAsync(25);
    await expect(resultPromise).resolves.toEqual({
      accepted: false,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      reason: 'timeout',
    });
  });

  it('returns aborted when the caller aborts before the configured timeout', async () => {
    const controller = new AbortController();
    const publisher = new EventBridgeAuditPublisher(abortableClient(), { eventBusArn, timeoutMs: 1_000 });
    const resultPromise = publisher.publish(canonicalRejectedAuthenticationEvent, { signal: controller.signal });
    controller.abort();
    await expect(resultPromise).resolves.toEqual({
      accepted: false,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      reason: 'aborted',
    });
  });
});

describe('inspectPutEventsResponse — engineer-owned behavior', () => {
  const auditEventId = canonicalRejectedAuthenticationEvent.metadata.uid;

  it.each([
    ['a missing entry list', { FailedEntryCount: 0 }],
    ['an empty entry list', { FailedEntryCount: 0, Entries: [] }],
    ['more than one result entry', { FailedEntryCount: 0, Entries: [{ EventId: 'one' }, { EventId: 'two' }] }],
    ['a missing failure count', { Entries: [{ EventId: 'transport-1' }] }],
    ['a contradictory failure count', { FailedEntryCount: 1, Entries: [{ EventId: 'transport-1' }] }],
    [
      'success and failure fields on the same entry',
      {
        FailedEntryCount: 1,
        Entries: [{ EventId: 'transport-1', ErrorCode: 'InternalFailure', ErrorMessage: 'private detail' }],
      },
    ],
    ['a missing transport event ID', { FailedEntryCount: 0, Entries: [{}] }],
    ['an empty transport event ID', { FailedEntryCount: 0, Entries: [{ EventId: '  ' }] }],
  ] satisfies ReadonlyArray<readonly [string, PutEventsResponseLike]>)(
    'rejects malformed response: %s',
    (_name, response) => {
      expect(inspectPutEventsResponse(response, auditEventId)).toEqual(rejected('unavailable'));
    },
  );

  it('returns transport acceptance only when the sole entry is fully accepted', () => {
    expect(
      inspectPutEventsResponse({ FailedEntryCount: 0, Entries: [{ EventId: 'transport-1' }] }, auditEventId),
    ).toEqual({ accepted: true, auditEventId, transportEventId: 'transport-1' });
  });

  it.each([
    ['ThrottlingException', 'throttled'],
    ['InternalFailure', 'unavailable'],
    ['AccessDeniedException', 'configuration'],
    ['UnknownFailure', 'rejected'],
  ] as const)('maps a failed result entry with %s to %s without exposing its message', (ErrorCode, reason) => {
    const response = {
      FailedEntryCount: 1,
      Entries: [{ ErrorCode, ErrorMessage: 'private AWS result detail' }],
    };
    const result = inspectPutEventsResponse(response, auditEventId);
    expect(result).toEqual(rejected(reason));
    expect(JSON.stringify(result)).not.toContain(ErrorCode);
    expect(JSON.stringify(result)).not.toContain('private AWS result detail');
  });

  function rejected(reason: Extract<AuditPublishResult, { accepted: false }>['reason']): AuditPublishResult {
    return { accepted: false, auditEventId, reason };
  }
});

function abortableClient(): EventBridgeClientLike {
  return {
    send(_command, options) {
      return new Promise<PutEventsCommandOutput>((_resolve, reject) => {
        options?.abortSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('private abort detail', 'AbortError')),
          { once: true },
        );
      });
    },
  };
}
