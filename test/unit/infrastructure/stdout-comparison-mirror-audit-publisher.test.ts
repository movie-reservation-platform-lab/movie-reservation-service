import type { AuditPublisher, AuthenticationAuditEvent } from '@movie-reservation-platform-lab/audit-sdk/core';
import {
  canonicalRejectedAuthenticationEvent,
  FakeAuditPublisher,
} from '@movie-reservation-platform-lab/audit-sdk/testing';
import { describe, expect, it } from 'vitest';

import { StdoutComparisonMirrorAuditPublisher } from '../../../src/infrastructure/audit/stdout-comparison-mirror-audit-publisher';

const event = canonicalRejectedAuthenticationEvent;

/**
 * Fake publisher that fails with the provided error.
 */
class ThrowingAuditPublisher implements AuditPublisher {
  readonly publishedEvents: AuthenticationAuditEvent[] = [];

  constructor(private readonly error: Error) {}

  async publish(publishedEvent: AuthenticationAuditEvent): Promise<never> {
    this.publishedEvents.push(publishedEvent);
    throw this.error;
  }
}

describe('StdoutComparisonMirrorAuditPublisher', () => {
  it('returns the primary accepted result when the comparison publisher throws', async () => {
    const primary = new FakeAuditPublisher();
    const comparisonFailure = new Error('random stdout failure');
    const comparison = new ThrowingAuditPublisher(comparisonFailure);
    const publisher = new StdoutComparisonMirrorAuditPublisher(primary, comparison);

    const result = await publisher.publish(event);

    expect(result).toEqual({
      accepted: true,
      auditEventId: event.metadata.uid,
      transportEventId: 'fake-event-0001',
    });
    expect(primary.publishedEvents[0]).toBe(event);
    expect(comparison.publishedEvents[0]).toBe(event);
  });

  it('returns the primary failure result and still calls the comparison publisher', async () => {
    const primary = new FakeAuditPublisher();
    const comparison = new FakeAuditPublisher();

    primary.enqueue({
      accepted: false,
      reason: 'timeout',
    });

    const publisher = new StdoutComparisonMirrorAuditPublisher(primary, comparison);

    const result = await publisher.publish(event);

    expect(result).toEqual({
      accepted: false,
      auditEventId: event.metadata.uid,
      reason: 'timeout',
    });

    expect(primary.publishedEvents[0]).toBe(event);
    expect(comparison.publishedEvents[0]).toBe(event);
  });

  it('rethrows the primary error and still calls the comparison publisher', async () => {
    const primaryFailure = new Error('random primary publish failure');
    const primary = new ThrowingAuditPublisher(primaryFailure);
    const comparison = new FakeAuditPublisher();

    const publisher = new StdoutComparisonMirrorAuditPublisher(primary, comparison);

    await expect(publisher.publish(event)).rejects.toBe(primaryFailure);

    expect(primary.publishedEvents[0]).toBe(event);
    expect(comparison.publishedEvents[0]).toBe(event);
  });
});
