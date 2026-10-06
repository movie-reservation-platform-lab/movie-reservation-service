import type {
  AuditPublishOptions,
  AuditPublishResult,
  AuditPublisher,
  AuthenticationAuditEvent,
} from '@movie-reservation-platform-lab/audit-sdk/core';

/**
 * Temporary comparison decorator (removed by roadmap PR 10): the primary
 * publisher decides the result, and the same already-built event is copied to
 * the comparison publisher best-effort.
 *
 * Contract:
 * - Returns the primary publisher's result, or rethrows its error, unchanged.
 * - Always calls the comparison publisher with the identical event object
 *   afterwards, including when the primary publish failed or threw.
 * - A comparison result or error never changes what is returned or thrown.
 */
export class StdoutComparisonMirrorAuditPublisher implements AuditPublisher {
  constructor(
    private readonly primaryPublisher: AuditPublisher,
    private readonly comparisonPublisher: AuditPublisher,
  ) {}

  async publish(event: AuthenticationAuditEvent, options?: AuditPublishOptions): Promise<AuditPublishResult> {
    try {
      return await this.primaryPublisher.publish(event, options);
    } finally {
      try {
        await this.comparisonPublisher.publish(event, options);
      } catch {
        // A best-effort comparison failure must not replace the primary result or error.
      }
    }
  }
}
