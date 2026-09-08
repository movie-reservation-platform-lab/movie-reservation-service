import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { buildAuthenticationAuditEvent } from '../../../src/application/audit/authentication-audit-event';
import { StdoutAuditEventSink } from '../../../src/infrastructure/audit/stdout-audit-event-sink';
import contract from '../../fixtures/audit/platform-audit-contract-v1.json';

function event() {
  return buildAuthenticationAuditEvent({
    uid: contract.event.metadata.uid,
    time: contract.event.time,
    correlationId: 'correlation-1',
    requestId: 'request-1',
    serviceName: 'movie-reservation-service',
    serviceVersion: 'test',
    environment: 'test',
    outcome: { authenticated: false, reason: 'INVALID_CREDENTIALS' },
    route: '/demo/auth/login',
    authBoundary: 'demo_login',
  });
}

describe('stdout audit adapter', () => {
  it('writes one compact raw JSON line with the audit object, not a logger message', () => {
    const output = new PassThrough();
    const failures = vi.fn<(reason: string) => void>();
    const sink = new StdoutAuditEventSink(output, failures);
    const input = event();

    expect(sink.emit(input)).toEqual({ accepted: true });

    const line: unknown = output.read();
    expect(Buffer.isBuffer(line)).toBe(true);
    const text = String(line);
    expect(text).toBe(`${JSON.stringify({ audit: input })}\n`);
    expect(failures).not.toHaveBeenCalled();
  });

  it('does not retry a line that the stream accepted into its buffer', () => {
    const write = vi.fn<() => boolean>(() => false);
    const sink = new StdoutAuditEventSink({ write, writableLength: 0 }, vi.fn<(reason: string) => void>());
    expect(sink.emit(event())).toEqual({ accepted: true });
    expect(write).toHaveBeenCalledOnce();
  });

  it('bounds its local output buffer and reports a drop', () => {
    const write = vi.fn<() => boolean>();
    const failures = vi.fn<(reason: string) => void>();
    const sink = new StdoutAuditEventSink({ write, writableLength: 262_144 }, failures);

    expect(sink.emit(event())).toEqual({ accepted: false, reason: 'buffer_full' });

    expect(write).not.toHaveBeenCalled();
    expect(failures).toHaveBeenCalledWith('buffer_full');
  });

  it('reports a synchronous output failure without leaking event data', () => {
    const failures = vi.fn<(reason: string) => void>();
    const sink = new StdoutAuditEventSink(
      {
        writableLength: 0,
        write() {
          throw new Error('unavailable');
        },
      },
      failures,
    );

    expect(sink.emit(event())).toEqual({ accepted: false, reason: 'write_failed' });
    expect(failures).toHaveBeenCalledWith('write_failed');
  });

  it('reports a later write callback failure without changing earlier local acceptance', async () => {
    const failures = vi.fn<(reason: string) => void>();
    const sink = new StdoutAuditEventSink(
      {
        writableLength: 0,
        write(_line: unknown, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void)) {
          if (typeof encodingOrCallback === 'function') {
            setImmediate(() => encodingOrCallback(new Error('private transport detail')));
          }
          return true;
        },
      },
      failures,
    );

    expect(sink.emit(event())).toEqual({ accepted: true });
    expect(failures).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(failures).toHaveBeenCalledExactlyOnceWith('write_failed');
  });
});
