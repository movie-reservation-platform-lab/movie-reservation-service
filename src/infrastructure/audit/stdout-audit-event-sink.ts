import type { Writable } from 'node:stream';

import type { AuthenticationAuditEvent } from '../../application/audit/authentication-audit-event';
import type {
  AuditEventSink,
  AuditLocalAcceptance,
  AuditWriteFailure,
} from '../../application/audit/ports/audit-event-sink';

type AuditOutput = Pick<Writable, 'write' | 'writableLength'>;

/** Writes the routing envelope directly, independently of Pino's level/message fields. */
export class StdoutAuditEventSink implements AuditEventSink {
  constructor(
    private readonly output: AuditOutput,
    private readonly reportFailure: (reason: AuditWriteFailure) => void,
    private readonly maxBufferedBytes = 262_144,
  ) {}

  emit(event: AuthenticationAuditEvent): AuditLocalAcceptance {
    const line = `${JSON.stringify({ audit: event })}\n`;
    if (this.output.writableLength + Buffer.byteLength(line) > this.maxBufferedBytes) {
      this.reportFailure('buffer_full');
      return { accepted: false, reason: 'buffer_full' };
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
    // A later callback failure is reported, but cannot change an already returned receipt.
    return localFailure ? { accepted: false, reason: 'write_failed' } : { accepted: true };
  }
}
