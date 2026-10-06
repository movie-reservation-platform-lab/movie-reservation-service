import type { AuditPublishFailureReason } from '@movie-reservation-platform-lab/audit-sdk/core';

import { serviceMeter } from './otel-meter';

export type AuditPublisherName = 'stdout' | 'eventbridge';
/** `primary` decides the audit result; `comparison` is the temporary best-effort copy. */
export type AuditPublisherRole = 'primary' | 'comparison';

export interface AuditPublishSample {
  readonly publisher: AuditPublisherName;
  readonly role: AuditPublisherRole;
  readonly outcome:
    { readonly accepted: true } | { readonly accepted: false; readonly reason: AuditPublishFailureReason };
  readonly durationMs: number;
}

// A Record forces a compile error when the SDK adds a failure reason this list misses.
const failureReasons = Object.keys({
  timeout: true,
  aborted: true,
  rejected: true,
  throttled: true,
  configuration: true,
  unavailable: true,
} satisfies Record<AuditPublishFailureReason, true>) as AuditPublishFailureReason[];

const auditPublishTotal = serviceMeter.createCounter('audit_publish_total', {
  description: 'Audit publish attempts by publisher, role, result and bounded failure reason.',
});
const auditPublishDurationMs = serviceMeter.createHistogram('audit_publish_duration_ms', {
  description: 'Audit publish duration in milliseconds, including the time to a timeout.',
  unit: 'ms',
});

/**
 * Pre-creates the zero series one configured publisher can produce, so a
 * failure alert has a baseline before the first failure.
 */
export function initializeAuditPublishMetricSeries(publisher: AuditPublisherName, role: AuditPublisherRole): void {
  const base = { audit_publisher: publisher, audit_publisher_role: role };
  auditPublishTotal.add(0, { ...base, result: 'accepted', failure_reason: 'none' });
  for (const reason of failureReasons) {
    auditPublishTotal.add(0, { ...base, result: 'failed', failure_reason: reason });
  }
}

/** Records one publish attempt. Attributes never carry event, request, trace or account IDs. */
export function recordAuditPublishMetrics(sample: AuditPublishSample): void {
  const base = {
    audit_publisher: sample.publisher,
    audit_publisher_role: sample.role,
    result: sample.outcome.accepted ? 'accepted' : 'failed',
  };
  auditPublishTotal.add(1, { ...base, failure_reason: sample.outcome.accepted ? 'none' : sample.outcome.reason });
  auditPublishDurationMs.record(sample.durationMs, base);
}
