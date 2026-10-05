import type { AuditPublishResult, AuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/core';

/**
 * Temporary comparison decorator (removed by roadmap PR 10): the required
 * publisher decides the result, and the same already-built event is copied to
 * the mirror best-effort.
 *
 * Contract:
 * - Returns the required publisher's result, or rethrows its error, unchanged.
 * - Always calls the mirror with the identical event object afterwards, also
 *   when the required publish failed or threw.
 * - A mirror result or error never changes what is returned or thrown.
 */
export class StdoutComparisonMirrorAuditPublisher implements AuditPublisher {
  constructor(
    private readonly required: AuditPublisher,
    private readonly mirror: AuditPublisher,
  ) {}

  // TODO(#51 step 5, engineer slice): implement the contract above, test-first,
  // with the signature publish(event: AuthenticationAuditEvent, options?: AuditPublishOptions).
  publish(): Promise<AuditPublishResult> {
    void this.required;
    void this.mirror;
    return Promise.reject(new Error('StdoutComparisonMirrorAuditPublisher is not implemented yet'));
  }
}
