import type { AuditPublishFailureReason, AuditPublishResult } from '../core/index.js';

export interface PutEventsResultEntryLike {
  readonly EventId?: string | undefined;
  readonly ErrorCode?: string | undefined;
  readonly ErrorMessage?: string | undefined;
}

export interface PutEventsResponseLike {
  readonly FailedEntryCount?: number | undefined;
  readonly Entries?: readonly PutEventsResultEntryLike[] | undefined;
}

/**
 * Translates the one-entry EventBridge response into a transport-neutral result.
 *
 * Unknown or contradictory response shapes fail closed without exposing AWS
 * error details.
 */
export function inspectPutEventsResponse(response: PutEventsResponseLike, auditEventId: string): AuditPublishResult {
  if (response.Entries?.length !== 1) {
    return unavailable(auditEventId);
  }
  const entry = response.Entries[0];
  if (entry === undefined) {
    return unavailable(auditEventId);
  }

  const failedEntryCount = response.FailedEntryCount;
  if (failedEntryCount === undefined) {
    return unavailable(auditEventId);
  }

  if (failedEntryCount > 1) {
    return unavailable(auditEventId);
  }

  const errorCode = entry.ErrorCode;
  const errorMessage = entry.ErrorMessage;

  if (failedEntryCount === 0) {
    if (errorCode !== undefined || errorMessage !== undefined) {
      return unavailable(auditEventId);
    }
    const eventId = entry.EventId;
    if (eventId === undefined || eventId.trim().length === 0) {
      return unavailable(auditEventId);
    }

    return {
      accepted: true,
      auditEventId,
      transportEventId: eventId,
    };
  }

  if (
    entry.EventId !== undefined ||
    errorCode === undefined ||
    errorCode.trim().length === 0 ||
    errorMessage === undefined
  ) {
    return unavailable(auditEventId);
  }

  return {
    accepted: false,
    auditEventId,
    reason: determineReason(errorCode),
  };
}

function unavailable(auditEventId: string): AuditPublishResult {
  return { accepted: false, auditEventId, reason: 'unavailable' };
}

function determineReason(errorCode: string): AuditPublishFailureReason {
  switch (errorCode) {
    case 'ThrottlingException':
      return 'throttled';
    case 'InternalFailure':
      return 'unavailable';
    case 'AccessDeniedException':
      return 'configuration';
    default:
      return 'rejected';
  }
}
