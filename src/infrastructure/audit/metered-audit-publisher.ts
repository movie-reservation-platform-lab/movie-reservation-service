import type {
  AuditPublishOptions,
  AuditPublishResult,
  AuditPublisher,
  AuthenticationAuditEvent,
} from '@movie-reservation-platform-lab/audit-sdk/core';

import {
  recordAuditPublishMetrics,
  type AuditPublishSample,
  type AuditPublisherName,
  type AuditPublisherRole,
} from '../observability/metrics/audit-publish-metrics';

/**
 * Wraps any publisher and records one metric sample per publish. It returns the
 * inner result or rethrows the inner error unchanged; a thrown error is counted
 * as `unavailable`, matching how the recorder treats it.
 */
export class MeteredAuditPublisher implements AuditPublisher {
  constructor(
    private readonly inner: AuditPublisher,
    private readonly labels: { readonly publisher: AuditPublisherName; readonly role: AuditPublisherRole },
    private readonly recordSample: (sample: AuditPublishSample) => void = recordAuditPublishMetrics,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async publish(event: AuthenticationAuditEvent, options?: AuditPublishOptions): Promise<AuditPublishResult> {
    const startedAt = this.now();
    try {
      const result = await this.inner.publish(event, options);
      this.record(result.accepted ? { accepted: true } : { accepted: false, reason: result.reason }, startedAt);
      return result;
    } catch (error) {
      this.record({ accepted: false, reason: 'unavailable' }, startedAt);
      throw error;
    }
  }

  private record(outcome: AuditPublishSample['outcome'], startedAt: number): void {
    this.recordSample({ ...this.labels, outcome, durationMs: this.now() - startedAt });
  }
}
