import { randomUUID } from 'node:crypto';

import { trace } from '@opentelemetry/api';

import {
  buildAuthenticationAuditEvent,
  type AuthenticationAuditAttempt,
} from '../../application/audit/authentication-audit-event';
import type { AuditEventSink } from '../../application/audit/ports/audit-event-sink';
import type {
  AuthenticationAuditRecorder,
  AuditReceipt,
} from '../../application/audit/ports/authentication-audit-recorder';
import type { ApplicationLogger } from '../observability/application-logger';
import { getCurrentRequestContext } from '../observability/request-context';

export interface AuditServiceIdentity {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: string;
}

export class RequestAuthenticationAuditRecorder implements AuthenticationAuditRecorder {
  constructor(
    private readonly identity: AuditServiceIdentity,
    private readonly sink: AuditEventSink,
    private readonly logger: Pick<ApplicationLogger, 'info' | 'error'>,
  ) {}

  record(attempt: AuthenticationAuditAttempt): AuditReceipt {
    const requestContext = getCurrentRequestContext();
    const spanContext = trace.getActiveSpan()?.spanContext();
    const activeSpan = spanContext !== undefined && trace.isSpanContextValid(spanContext) ? spanContext : undefined;
    const event = buildAuthenticationAuditEvent({
      ...attempt,
      ...this.identity,
      uid: randomUUID(),
      time: Date.now(),
      requestId: requestContext?.requestId ?? randomUUID(),
      correlationId: requestContext?.correlationId ?? randomUUID(),
      ...(activeSpan === undefined ? {} : { traceId: activeSpan.traceId, spanId: activeSpan.spanId }),
      ...(requestContext?.awsXAmznTraceId === undefined ? {} : { awsAlbTraceId: requestContext.awsXAmznTraceId }),
      ...(requestContext?.awsCloudfrontRequestId === undefined
        ? {}
        : { awsCloudfrontRequestId: requestContext.awsCloudfrontRequestId }),
    });
    try {
      this.sink.emit(event);
    } catch {
      // A transport failure must not turn a rejected authentication into a success.
      this.logger.error('audit.emit.failed', { audit_event_id: event.metadata.uid });
    }
    const platform = event.unmapped.platform;
    this.logger.info('audit.authentication', {
      audit_event_id: event.metadata.uid,
      correlation_id: event.metadata.correlation_uid,
      request_id: platform.request_id,
      trace_id: platform.trace_id,
      span_id: platform.span_id,
      aws_alb_trace_id: platform.aws_alb_trace_id,
      aws_cloudfront_request_id: platform.aws_cloudfront_request_id,
      auth_boundary: platform.auth_boundary,
      auth_status_id: event.status_id,
    });
    return {
      request_id: platform.request_id,
      audit_event_id: event.metadata.uid,
      ...(platform.trace_id === undefined ? {} : { trace_id: platform.trace_id }),
    };
  }
}
