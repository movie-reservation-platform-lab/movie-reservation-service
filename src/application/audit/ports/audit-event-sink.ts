import type { AuthenticationAuditEvent } from '../authentication-audit-event';

export type AuditWriteFailure = 'buffer_full' | 'write_failed';
export type AuditLocalAcceptance =
  { readonly accepted: true } | { readonly accepted: false; readonly reason: AuditWriteFailure };

export interface AuditEventSink {
  /** Local handoff only; not an acknowledgement from the archive. */
  emit(event: AuthenticationAuditEvent): AuditLocalAcceptance;
}
