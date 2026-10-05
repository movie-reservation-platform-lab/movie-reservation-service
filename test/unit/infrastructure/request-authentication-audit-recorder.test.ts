import { createFixedAuditEventProviders, FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';
import { context, propagation, trace, TraceFlags } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditEmissionUnavailableError } from '../../../src/application/audit/audit-emission-unavailable-error';
import { RequestAuthenticationAuditRecorder } from '../../../src/infrastructure/audit/request-authentication-audit-recorder';
import { runWithRequestContext } from '../../../src/infrastructure/observability/request-context';
import type { ApplicationLogger } from '../../../src/infrastructure/observability/application-logger';

const traceId = '6a9dd2710123456789abcdef01234567';
const spanId = '0123456789abcdef';
const anyString: unknown = expect.any(String);

function createRecorder() {
  const publisher = new FakeAuditPublisher();
  const logger = { info: vi.fn<ApplicationLogger['info']>(), error: vi.fn<ApplicationLogger['error']>() };
  const recorder = new RequestAuthenticationAuditRecorder(
    {
      serviceName: 'movie-reservation-service',
      serviceVersion: 'test-build',
      environment: 'test',
    },
    publisher,
    logger,
  );
  return { recorder, publisher, logger };
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

  it('joins response, operational log and audit record with a real active unsampled context', async () => {
    const { recorder, publisher, logger } = createRecorder();
    const activeContext = trace.setSpanContext(context.active(), { traceId, spanId, traceFlags: TraceFlags.NONE });

    const receipt = await context.with(activeContext, () =>
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

    const event = publisher.publishedEvents[0];
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

  it('does not report a caller traceparent as an active trace when tracing is unavailable', async () => {
    const { recorder, publisher } = createRecorder();
    const receipt = await runWithRequestContext(
      {
        requestId: 'request-1',
        correlationId: 'action-1',
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      },
      () => recorder.record(attempt),
    );

    const platform = publisher.publishedEvents[0]?.unmapped.platform;
    expect(receipt).not.toHaveProperty('trace_id');
    expect(platform).not.toHaveProperty('trace_id');
    expect(platform).not.toHaveProperty('span_id');
  });

  it('keeps concurrent request and trace contexts separate', async () => {
    const { recorder, publisher } = createRecorder();
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

    const events = [...publisher.publishedEvents].sort((left, right) =>
      left.metadata.correlation_uid.localeCompare(right.metadata.correlation_uid),
    );
    expect(events).toHaveLength(3);
    for (const [index, event] of events.entries()) {
      expect(event.metadata.correlation_uid).toBe(`action-${index + 1}`);
      expect(event.unmapped.platform.request_id).toBe(`request-${index + 1}`);
      expect(event.unmapped.platform.trace_id).toBe(String(index + 1).repeat(32));
    }
    expect(new Set(events.map((event) => event.metadata.uid)).size).toBe(3);
  });

  it('builds the event with injected time and ID providers', async () => {
    const publisher = new FakeAuditPublisher();
    const recorder = new RequestAuthenticationAuditRecorder(
      { serviceName: 'movie-reservation-service', serviceVersion: 'test-build', environment: 'test' },
      publisher,
      { info: vi.fn<ApplicationLogger['info']>(), error: vi.fn<ApplicationLogger['error']>() },
      createFixedAuditEventProviders(1_788_814_800_000, '11111111-1111-4111-8111-111111111111'),
    );

    const receipt = await recorder.record(attempt);

    expect(receipt.audit_event_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(publisher.publishedEvents[0]).toMatchObject({
      time: 1_788_814_800_000,
      metadata: { uid: '11111111-1111-4111-8111-111111111111' },
    });
  });

  it('rejects without a receipt or event body in logs when the publisher throws', async () => {
    const { recorder, publisher, logger } = createRecorder();
    vi.spyOn(publisher, 'publish').mockRejectedValueOnce(new Error('private transport detail'));

    await expect(recorder.record(attempt)).rejects.toThrow(AuditEmissionUnavailableError);
    expect(logger.error).toHaveBeenCalledWith('audit.emit.failed', {
      audit_event_id: anyString,
      failure_reason: 'unavailable',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'timeout', 'rejected'] as const)(
    'rejects without a receipt when the publisher reports %s',
    async (reason) => {
      const { recorder, publisher, logger } = createRecorder();
      publisher.enqueue({ accepted: false, reason });

      await expect(recorder.record(attempt)).rejects.toThrow(AuditEmissionUnavailableError);
      expect(logger.error).toHaveBeenCalledWith('audit.emit.failed', {
        audit_event_id: anyString,
        failure_reason: reason,
      });
      expect(logger.info).not.toHaveBeenCalled();
    },
  );
});
