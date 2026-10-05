import type { Writable } from 'node:stream';

import type {
  AuditPublishResult,
  AuditPublisher,
  AuthenticationAuditEvent,
} from '@movie-reservation-platform-lab/audit-sdk/core';

export type StdoutAuditWriteFailure = 'buffer_full' | 'write_failed';

type AuditOutput = Pick<Writable, 'write' | 'writableLength'>;

/**
 * Writes the `{"audit":<event>}` routing line the legacy FireLens path reads,
 * independently of Pino's level/message fields.
 *
 * Acceptance means the line entered this process's output buffer; it is weaker
 * than a remote publisher's acknowledgement and makes no claim about archiving.
 */
export class StdoutAuditPublisher implements AuditPublisher {
  constructor(
    private readonly output: AuditOutput,
    private readonly reportFailure: (reason: StdoutAuditWriteFailure) => void,
    private readonly maxBufferedBytes = 262_144,
  ) {}

  async publish(event: AuthenticationAuditEvent): Promise<AuditPublishResult> {
    const auditEventId = event.metadata.uid;
    const line = `${JSON.stringify({ audit: event })}\n`;
    if (this.output.writableLength + Buffer.byteLength(line) > this.maxBufferedBytes) {
      this.reportFailure('buffer_full');
      return { accepted: false, auditEventId, reason: 'unavailable' };
    }
    let localFailure = false;
    try {
      // false means buffered/backpressured, not failed. Never retry the same line here.
      this.output.write(line, (error?: Error | null) => {
        if (error !== undefined && error !== null) {
          localFailure = true;
          this.reportFailure('write_failed');
        }
      });
    } catch {
      localFailure = true;
      this.reportFailure('write_failed');
    }
    // A later callback failure is reported, but cannot change an already returned result.
    return localFailure ? { accepted: false, auditEventId, reason: 'unavailable' } : { accepted: true, auditEventId };
  }
}
