import type { Writable } from 'node:stream';

import type { AuthenticationAuditEvent } from '../../application/audit/authentication-audit-event';
import type { AuditEventSink } from '../../application/audit/ports/audit-event-sink';

type AuditOutput = Pick<Writable, 'write' | 'writableLength'>;
type AuditWriteFailure = 'buffer_full' | 'write_failed';

/** Writes the routing envelope directly, independently of Pino's level/message fields. */
export class StdoutAuditEventSink implements AuditEventSink {
  constructor(
    private readonly output: AuditOutput,
    private readonly reportFailure: (reason: AuditWriteFailure) => void,
    private readonly maxBufferedBytes = 262_144,
  ) {}

  emit(event: AuthenticationAuditEvent): void {
    const line = `${JSON.stringify({ audit: event })}\n`;
    if (this.output.writableLength + Buffer.byteLength(line) > this.maxBufferedBytes) {
      this.reportFailure('buffer_full');
      return;
    }
    try {
      // false means buffered/backpressured, not failed. Never retry the same line here.
      this.output.write(line, (error?: Error | null) => {
        if (error !== undefined && error !== null) {
          this.reportFailure('write_failed');
        }
      });
    } catch {
      this.reportFailure('write_failed');
    }
  }
}
