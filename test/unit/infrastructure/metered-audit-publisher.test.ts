import type { AuditPublishResult } from '@movie-reservation-platform-lab/audit-sdk/core';
import {
  canonicalRejectedAuthenticationEvent,
  FakeAuditPublisher,
} from '@movie-reservation-platform-lab/audit-sdk/testing';
import { describe, expect, it, vi } from 'vitest';

import { MeteredAuditPublisher } from '../../../src/infrastructure/audit/metered-audit-publisher';
import type { AuditPublishSample } from '../../../src/infrastructure/observability/metrics/audit-publish-metrics';

const event = canonicalRejectedAuthenticationEvent;

function createMeteredPublisher(inner: FakeAuditPublisher) {
  const samples: AuditPublishSample[] = [];
  const times = [10, 35];
  const publisher = new MeteredAuditPublisher(
    inner,
    { publisher: 'eventbridge', role: 'primary' },
    (sample) => samples.push(sample),
    () => times.shift() ?? 0,
  );
  return { publisher, samples };
}

describe('MeteredAuditPublisher', () => {
  it('returns an accepted result unchanged and records it with its duration', async () => {
    const inner = new FakeAuditPublisher();
    const { publisher, samples } = createMeteredPublisher(inner);

    const result = await publisher.publish(event);

    expect(result).toEqual({ accepted: true, auditEventId: event.metadata.uid, transportEventId: 'fake-event-0001' });
    expect(inner.publishedEvents).toEqual([event]);
    expect(samples).toEqual([
      { publisher: 'eventbridge', role: 'primary', outcome: { accepted: true }, durationMs: 25 },
    ]);
  });

  it.each(['timeout', 'throttled', 'unavailable'] as const)(
    'returns a %s failure unchanged and records only its bounded reason',
    async (reason) => {
      const inner = new FakeAuditPublisher();
      inner.enqueue({ accepted: false, reason });
      const { publisher, samples } = createMeteredPublisher(inner);

      const result: AuditPublishResult = await publisher.publish(event);

      expect(result).toEqual({ accepted: false, auditEventId: event.metadata.uid, reason });
      expect(samples).toEqual([
        { publisher: 'eventbridge', role: 'primary', outcome: { accepted: false, reason }, durationMs: 25 },
      ]);
    },
  );

  it('rethrows a publisher error and counts it as unavailable', async () => {
    const inner = new FakeAuditPublisher();
    const failure = new Error('private transport detail');
    vi.spyOn(inner, 'publish').mockRejectedValueOnce(failure);
    const { publisher, samples } = createMeteredPublisher(inner);

    await expect(publisher.publish(event)).rejects.toBe(failure);
    expect(samples).toEqual([
      {
        publisher: 'eventbridge',
        role: 'primary',
        outcome: { accepted: false, reason: 'unavailable' },
        durationMs: 25,
      },
    ]);
  });

  it('passes the abort signal through', async () => {
    const inner = new FakeAuditPublisher();
    const publish = vi.spyOn(inner, 'publish');
    const { publisher } = createMeteredPublisher(inner);
    const signal = new AbortController().signal;

    await publisher.publish(event, { signal });

    expect(publish).toHaveBeenCalledWith(event, { signal });
  });
});
