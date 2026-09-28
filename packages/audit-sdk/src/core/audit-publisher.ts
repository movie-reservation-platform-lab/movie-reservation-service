import type { AuthenticationAuditEvent } from './authentication-audit-event.js';

export type AuditPublishFailureReason =
  'timeout' | 'aborted' | 'rejected' | 'throttled' | 'configuration' | 'unavailable';

export type AuditPublishResult =
  | {
      readonly accepted: true;
      readonly auditEventId: string;
      readonly transportEventId?: string;
    }
  | {
      readonly accepted: false;
      readonly auditEventId: string;
      readonly reason: AuditPublishFailureReason;
    };

export interface AuditPublishOptions {
  readonly signal?: AbortSignal;
}

export interface AuditPublisher {
  publish(event: AuthenticationAuditEvent, options?: AuditPublishOptions): Promise<AuditPublishResult>;
}
