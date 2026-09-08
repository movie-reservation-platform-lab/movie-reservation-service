import type { AuthenticationAuditAttempt } from '../authentication-audit-event';

export interface AuditReceipt {
  readonly request_id: string;
  readonly audit_event_id: string;
  readonly trace_id?: string;
}

export interface AuthenticationAuditRecorder {
  record(attempt: AuthenticationAuditAttempt): AuditReceipt;
}
