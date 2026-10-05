import type { EventBridgeAuditPublisherConfig } from '@movie-reservation-platform-lab/audit-sdk/eventbridge';
import { AuditPublisherConfigurationError } from '@movie-reservation-platform-lab/audit-sdk/eventbridge';
import {
  canonicalRejectedAuthenticationEvent,
  FakeAuditPublisher,
} from '@movie-reservation-platform-lab/audit-sdk/testing';
import { describe, expect, it } from 'vitest';

import { createAuditPublisher, type AuditPublisherDependencies } from '../../../src/di/audit/create-audit-publisher';

const event = canonicalRejectedAuthenticationEvent;
const eventBusArn = 'arn:aws:events:eu-central-1:222222222222:event-bus/movie-platform-audit';

function fakeDependencies() {
  const stdout = new FakeAuditPublisher();
  const eventBridge = new FakeAuditPublisher();
  const eventBridgeConfigs: EventBridgeAuditPublisherConfig[] = [];
  const dependencies: AuditPublisherDependencies = {
    stdout,
    createEventBridge: (config) => {
      eventBridgeConfigs.push(config);
      return eventBridge;
    },
  };
  return { stdout, eventBridge, eventBridgeConfigs, dependencies };
}

// Behavior through fakes rather than instanceof chains, so the graph can be refactored freely.
describe('createAuditPublisher', () => {
  it('publishes only to stdout by default', async () => {
    const { stdout, eventBridgeConfigs, dependencies } = fakeDependencies();

    const result = await createAuditPublisher({ publisher: 'stdout' }, dependencies).publish(event);

    expect(result.accepted).toBe(true);
    expect(stdout.publishedEvents).toEqual([event]);
    expect(eventBridgeConfigs).toEqual([]);
  });

  it('publishes only to EventBridge with the configured bus and timeout when the mirror is off', async () => {
    const { stdout, eventBridge, eventBridgeConfigs, dependencies } = fakeDependencies();
    eventBridge.enqueue({ accepted: false, reason: 'timeout' });

    const result = await createAuditPublisher(
      { publisher: 'eventbridge', eventBusArn, timeoutMs: 250, stdoutComparisonMirror: false },
      dependencies,
    ).publish(event);

    expect(result).toEqual({ accepted: false, auditEventId: event.metadata.uid, reason: 'timeout' });
    expect(eventBridgeConfigs).toEqual([{ eventBusArn, timeoutMs: 250 }]);
    expect(eventBridge.publishedEvents).toEqual([event]);
    expect(stdout.publishedEvents).toEqual([]);
  });

  it('fails at composition, not on the first login, for a malformed bus ARN', () => {
    expect(() =>
      createAuditPublisher({
        publisher: 'eventbridge',
        eventBusArn: 'arn:aws:events:eu-central-1:222222222222:rule/not-a-bus',
        timeoutMs: 1_000,
        stdoutComparisonMirror: false,
      }),
    ).toThrow(AuditPublisherConfigurationError);
  });
});
