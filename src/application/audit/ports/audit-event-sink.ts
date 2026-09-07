import type { AuthenticationAuditEvent } from '../authentication-audit-event';

export interface AuditEventSink {
  /** Local handoff only; not an acknowledgement from the archive. */
  emit(event: AuthenticationAuditEvent): void;
}
