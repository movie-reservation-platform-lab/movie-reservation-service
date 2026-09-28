import { describe, expect, it } from 'vitest';

import type { AuthenticationAuditEvent } from '../../src/core/index.js';
import { canonicalRejectedAuthenticationEvent, FakeAuditPublisher } from '../../src/testing/index.js';

describe('FakeAuditPublisher', () => {
  it('captures events in order and returns deterministic default transport IDs', async () => {
    const publisher = new FakeAuditPublisher();

    await expect(publisher.publish(canonicalRejectedAuthenticationEvent)).resolves.toEqual({
      accepted: true,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      transportEventId: 'fake-event-0001',
    });
    await expect(publisher.publish(canonicalRejectedAuthenticationEvent)).resolves.toMatchObject({
      transportEventId: 'fake-event-0002',
    });
    expect(publisher.publishedEvents).toEqual([
      canonicalRejectedAuthenticationEvent,
      canonicalRejectedAuthenticationEvent,
    ]);
  });

  it('returns queued outcomes deterministically and can reset mutable state', async () => {
    const publisher = new FakeAuditPublisher([{ accepted: false, reason: 'throttled' }]);
    await expect(publisher.publish(canonicalRejectedAuthenticationEvent)).resolves.toEqual({
      accepted: false,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      reason: 'throttled',
    });
    publisher.reset();
    expect(publisher.publishedEvents).toEqual([]);
    await expect(publisher.publish(canonicalRejectedAuthenticationEvent)).resolves.toMatchObject({
      transportEventId: 'fake-event-0001',
    });
  });

  it('does not capture an event when the caller signal is already aborted', async () => {
    const signal = AbortSignal.abort();
    const publisher = new FakeAuditPublisher();
    await expect(publisher.publish(canonicalRejectedAuthenticationEvent, { signal })).resolves.toEqual({
      accepted: false,
      auditEventId: canonicalRejectedAuthenticationEvent.metadata.uid,
      reason: 'aborted',
    });
    expect(publisher.publishedEvents).toEqual([]);
  });

  it('does not expose mutable capture state', async () => {
    const publisher = new FakeAuditPublisher();
    await publisher.publish(canonicalRejectedAuthenticationEvent);

    const snapshot = publisher.publishedEvents as AuthenticationAuditEvent[];
    snapshot.length = 0;

    expect(publisher.publishedEvents).toEqual([canonicalRejectedAuthenticationEvent]);
  });
});
