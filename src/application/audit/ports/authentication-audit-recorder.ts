import type { AuthenticationAuditAttempt } from '../authentication-audit-attempt';

export interface AuditReceipt {
  readonly request_id: string;
  readonly audit_event_id: string;
  readonly trace_id?: string;
}

export interface AuthenticationAuditRecorder {
  /**
   * Resolves once the configured audit publisher accepted the event. Rejects with
   * `AuditEmissionUnavailableError` when it did not; callers own what that means
   * for the authentication outcome.
   */
  record(attempt: AuthenticationAuditAttempt): Promise<AuditReceipt>;
}
