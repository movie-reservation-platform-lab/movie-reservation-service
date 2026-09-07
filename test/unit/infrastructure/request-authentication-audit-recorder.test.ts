import { context, propagation, trace, TraceFlags } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthenticationAuditEvent } from '../../../src/application/audit/authentication-audit-event';
import { AuditEmissionUnavailableError } from '../../../src/application/audit/audit-emission-unavailable-error';
import type { AuditLocalAcceptance } from '../../../src/application/audit/ports/audit-event-sink';
import { RequestAuthenticationAuditRecorder } from '../../../src/infrastructure/audit/request-authentication-audit-recorder';
import { runWithRequestContext } from '../../../src/infrastructure/observability/request-context';
import type { ApplicationLogger } from '../../../src/infrastructure/observability/application-logger';

const traceId = '6a9dd2710123456789abcdef01234567';
const spanId = '0123456789abcdef';
const anyString: unknown = expect.any(String);

function createRecorder() {
  const events: AuthenticationAuditEvent[] = [];
  const logger = { info: vi.fn<ApplicationLogger['info']>(), error: vi.fn<ApplicationLogger['error']>() };
  const sink = {
    emit(event: AuthenticationAuditEvent): AuditLocalAcceptance {
      events.push(event);
      return { accepted: true };
    },
  };
  const recorder = new RequestAuthenticationAuditRecorder(
    {
      serviceName: 'movie-reservation-service',
      serviceVersion: 'test-build',
      environment: 'test',
    },
    sink,
    logger,
  );
  return { recorder, events, logger, sink };
}

const attempt = {
  outcome: { authenticated: false, reason: 'INVALID_CREDENTIALS' },
  route: '/demo/auth/login',
  authBoundary: 'demo_login',
} as const;

describe('request-aware audit recorder', () => {
  const sdk = new NodeSDK({ spanProcessors: [], logRecordProcessors: [], autoDetectResources: false });
  beforeAll(() => sdk.start());
  afterAll(async () => {
    await sdk.shutdown();
    context.disable();
    propagation.disable();
    trace.disable();
  });

  it('joins response, operational log and audit record with a real active unsampled context', () => {
    const { recorder, events, logger } = createRecorder();
    const activeContext = trace.setSpanContext(context.active(), { traceId, spanId, traceFlags: TraceFlags.NONE });

    const receipt = context.with(activeContext, () =>
      runWithRequestContext(
        {
          requestId: 'request-1',
          correlationId: 'action-1',
          traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
          awsXAmznTraceId: 'Root=1-6a9dd271-0123456789abcdef01234567',
          awsCloudfrontRequestId: 'actual-cloudfront-header',
        },
        () => recorder.record(attempt),
      ),
    );

    const event = events[0];
    expect(event).toMatchObject({
      metadata: { uid: receipt.audit_event_id, correlation_uid: 'action-1' },
      unmapped: {
        platform: {
          request_id: 'request-1',
          trace_id: traceId,
          span_id: spanId,
          aws_alb_trace_id: 'Root=1-6a9dd271-0123456789abcdef01234567',
          aws_cloudfront_request_id: 'actual-cloudfront-header',
        },
      },
    });
    expect(receipt.trace_id).toBe(traceId);
    expect(logger.info).toHaveBeenCalledWith(
      'audit.authentication',
      expect.objectContaining({
        audit_event_id: receipt.audit_event_id,
        request_id: 'request-1',
        trace_id: traceId,
        span_id: spanId,
      }),
    );
  });

  it('does not report a caller traceparent as an active trace when tracing is unavailable', () => {
    const { recorder, events } = createRecorder();
    const receipt = runWithRequestContext(
      {
        requestId: 'request-1',
        correlationId: 'action-1',
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      },
      () => recorder.record(attempt),
    );

    expect(receipt).not.toHaveProperty('trace_id');
    expect(events[0]?.unmapped.platform).not.toHaveProperty('trace_id');
    expect(events[0]?.unmapped.platform).not.toHaveProperty('span_id');
  });

  it('keeps concurrent request and trace contexts separate', async () => {
    const { recorder, events } = createRecorder();
    await Promise.all(
      [1, 2, 3].map(async (index) => {
        const requestTraceId = String(index).repeat(32);
        const activeContext = trace.setSpanContext(context.active(), {
          traceId: requestTraceId,
          spanId,
          traceFlags: TraceFlags.SAMPLED,
        });
        return context.with(activeContext, () =>
          runWithRequestContext(
            {
              requestId: `request-${index}`,
              correlationId: `action-${index}`,
            },
            async () => {
              await new Promise<void>((resolve) => setImmediate(resolve));
              return recorder.record(attempt);
            },
          ),
        );
      }),
    );

    expect(events).toHaveLength(3);
    for (const [index, event] of events.entries()) {
      expect(event.metadata.correlation_uid).toBe(`action-${index + 1}`);
      expect(event.unmapped.platform.request_id).toBe(`request-${index + 1}`);
      expect(event.unmapped.platform.trace_id).toBe(String(index + 1).repeat(32));
    }
    expect(new Set(events.map((event) => event.metadata.uid)).size).toBe(3);
  });

  it('reports an emission exception without returning a receipt or logging the event body', () => {
    const { recorder, sink, logger } = createRecorder();
    vi.spyOn(sink, 'emit').mockImplementation(() => {
      throw new Error('output unavailable');
    });

    expect(() => recorder.record(attempt)).toThrow(AuditEmissionUnavailableError);
    expect(logger.error).toHaveBeenCalledWith('audit.emit.failed', { audit_event_id: anyString });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(['buffer_full', 'write_failed'] as const)(
    'does not return a receipt when the local sink reports %s',
    (reason) => {
      const { recorder, sink, logger } = createRecorder();
      vi.spyOn(sink, 'emit').mockReturnValue({ accepted: false, reason });

      expect(() => recorder.record(attempt)).toThrow(AuditEmissionUnavailableError);
      expect(logger.error).toHaveBeenCalledWith('audit.emit.failed', { audit_event_id: anyString });
      expect(logger.info).not.toHaveBeenCalled();
    },
  );
});
