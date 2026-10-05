import { PassThrough } from 'node:stream';

import {
  buildAuthenticationAuditEvent,
  validateAuthenticationAuditEvent,
  type AuthenticationAuditEvent,
} from '@movie-reservation-platform-lab/audit-sdk/core';
import { createFixedAuditEventProviders } from '@movie-reservation-platform-lab/audit-sdk/testing';
import { describe, expect, it, vi } from 'vitest';

import { StdoutAuditPublisher } from '../../../src/infrastructure/audit/stdout-audit-publisher';
import contract from '../../fixtures/audit/platform-audit-contract-v1.json';

/** Rebuilds the legacy service contract fixture through the SDK builder. */
function legacyContractEvent(): AuthenticationAuditEvent {
  const platform = contract.event.unmapped.platform;
  return buildAuthenticationAuditEvent(
    {
      outcome: { authenticated: false, reason: 'INVALID_CREDENTIALS' },
      route: '/demo/auth/login',
      authBoundary: 'demo_login',
      correlationId: contract.event.metadata.correlation_uid,
      requestId: platform.request_id,
      serviceName: 'movie-reservation-service',
      serviceVersion: contract.event.service.version,
      environment: platform.environment,
      traceId: platform.trace_id,
      spanId: platform.span_id,
      awsAlbTraceId: platform.aws_alb_trace_id,
    },
    createFixedAuditEventProviders(contract.event.time, contract.event.metadata.uid),
  );
}

describe('stdout audit publisher', () => {
  it('writes the exact legacy FireLens line for the shared contract fixture', async () => {
    const output = new PassThrough();
    const failures = vi.fn<(reason: string) => void>();
    const publisher = new StdoutAuditPublisher(output, failures);
    const event = legacyContractEvent();

    await expect(publisher.publish(event)).resolves.toEqual({
      accepted: true,
      auditEventId: contract.event.metadata.uid,
    });

    const line: unknown = output.read();
    expect(Buffer.isBuffer(line)).toBe(true);
    // Byte-for-byte: key order and omitted optionals are part of the stdout contract.
    expect(String(line)).toBe(`${JSON.stringify({ audit: contract.event })}\n`);
    expect(validateAuthenticationAuditEvent(event).valid).toBe(true);
    expect(failures).not.toHaveBeenCalled();
  });

  it('does not retry a line that the stream accepted into its buffer', async () => {
    const write = vi.fn<() => boolean>(() => false);
    const publisher = new StdoutAuditPublisher({ write, writableLength: 0 }, vi.fn<(reason: string) => void>());

    await expect(publisher.publish(legacyContractEvent())).resolves.toMatchObject({ accepted: true });
    expect(write).toHaveBeenCalledOnce();
  });

  it('bounds its local output buffer and reports a drop as unavailable', async () => {
    const write = vi.fn<() => boolean>();
    const failures = vi.fn<(reason: string) => void>();
    const publisher = new StdoutAuditPublisher({ write, writableLength: 262_144 }, failures);

    await expect(publisher.publish(legacyContractEvent())).resolves.toEqual({
      accepted: false,
      auditEventId: contract.event.metadata.uid,
      reason: 'unavailable',
    });
    expect(write).not.toHaveBeenCalled();
    expect(failures).toHaveBeenCalledWith('buffer_full');
  });

  it('reports a synchronous output failure without leaking event data', async () => {
    const failures = vi.fn<(reason: string) => void>();
    const publisher = new StdoutAuditPublisher(
      {
        writableLength: 0,
        write() {
          throw new Error('unavailable');
        },
      },
      failures,
    );

    await expect(publisher.publish(legacyContractEvent())).resolves.toEqual({
      accepted: false,
      auditEventId: contract.event.metadata.uid,
      reason: 'unavailable',
    });
    expect(failures).toHaveBeenCalledWith('write_failed');
  });

  it('reports a later write callback failure without changing earlier local acceptance', async () => {
    const failures = vi.fn<(reason: string) => void>();
    const publisher = new StdoutAuditPublisher(
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

    await expect(publisher.publish(legacyContractEvent())).resolves.toMatchObject({ accepted: true });
    expect(failures).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(failures).toHaveBeenCalledExactlyOnceWith('write_failed');
  });
});
