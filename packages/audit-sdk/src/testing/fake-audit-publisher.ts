import type {
  AuditPublishFailureReason,
  AuditPublishOptions,
  AuditPublishResult,
  AuditPublisher,
  AuthenticationAuditEvent,
} from '../core/index.js';

export type FakeAuditPublishOutcome =
  | { readonly accepted: true; readonly transportEventId?: string }
  | { readonly accepted: false; readonly reason: AuditPublishFailureReason };

export class FakeAuditPublisher implements AuditPublisher {
  private readonly events: AuthenticationAuditEvent[] = [];
  private readonly queuedOutcomes: FakeAuditPublishOutcome[];

  constructor(outcomes: readonly FakeAuditPublishOutcome[] = []) {
    this.queuedOutcomes = [...outcomes];
  }

  get publishedEvents(): readonly AuthenticationAuditEvent[] {
    return [...this.events];
  }

  enqueue(outcome: FakeAuditPublishOutcome): void {
    this.queuedOutcomes.push(outcome);
  }

  reset(): void {
    this.events.length = 0;
    this.queuedOutcomes.length = 0;
  }

  async publish(event: AuthenticationAuditEvent, options: AuditPublishOptions = {}): Promise<AuditPublishResult> {
    if (options.signal?.aborted === true) {
      return { accepted: false, auditEventId: event.metadata.uid, reason: 'aborted' };
    }
    this.events.push(event);
    const sequence = this.events.length;
    const outcome = this.queuedOutcomes.shift() ?? {
      accepted: true,
      transportEventId: `fake-event-${String(sequence).padStart(4, '0')}`,
    };
    return outcome.accepted
      ? {
          accepted: true,
          auditEventId: event.metadata.uid,
          ...(outcome.transportEventId === undefined ? {} : { transportEventId: outcome.transportEventId }),
        }
      : { accepted: false, auditEventId: event.metadata.uid, reason: outcome.reason };
  }
}
