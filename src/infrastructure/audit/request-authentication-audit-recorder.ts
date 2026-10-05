import { randomUUID } from 'node:crypto';

import {
  buildAuthenticationAuditEvent,
  systemAuditEventProviders,
  type AuditEventProviders,
  type AuditPublishResult,
  type AuditPublisher,
  type AuditServiceName,
  type AuthenticationFailureReason as SdkAuthenticationFailureReason,
} from '@movie-reservation-platform-lab/audit-sdk/core';
import { trace } from '@opentelemetry/api';

import { AuditEmissionUnavailableError } from '../../application/audit/audit-emission-unavailable-error';
import type {
  AuthenticationAuditAttempt,
  AuthenticationFailureReason as ApplicationAuthenticationFailureReason,
} from '../../application/audit/authentication-audit-attempt';
import type {
  AuthenticationAuditRecorder,
  AuditReceipt,
} from '../../application/audit/ports/authentication-audit-recorder';
import type { ApplicationLogger } from '../observability/application-logger';
import { getCurrentRequestContext } from '../observability/request-context';

export interface AuditServiceIdentity {
  readonly serviceName: AuditServiceName;
  readonly serviceVersion: string;
  readonly environment: string;
}

const sdkFailureReasonByApplicationReason = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
  MALFORMED_CREDENTIALS: 'MALFORMED_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
} as const satisfies Record<ApplicationAuthenticationFailureReason, SdkAuthenticationFailureReason>;

/** Adapts application authentication attempts to the audit SDK contract and publisher. */
export class RequestAuthenticationAuditRecorder implements AuthenticationAuditRecorder {
  constructor(
    private readonly identity: AuditServiceIdentity,
    private readonly publisher: AuditPublisher,
    private readonly logger: Pick<ApplicationLogger, 'info' | 'error'>,
    private readonly providers: AuditEventProviders = systemAuditEventProviders,
  ) {}

  async record(attempt: AuthenticationAuditAttempt): Promise<AuditReceipt> {
    const requestContext = getCurrentRequestContext();
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();
    const activeSpan = spanContext !== undefined && trace.isSpanContextValid(spanContext) ? spanContext : undefined;
    const outcome = attempt.outcome.authenticated
      ? attempt.outcome
      : {
          authenticated: false as const,
          reason: sdkFailureReasonByApplicationReason[attempt.outcome.reason],
        };
    const event = buildAuthenticationAuditEvent(
      {
        ...attempt,
        outcome,
        ...this.identity,
        requestId: requestContext?.requestId ?? randomUUID(),
        correlationId: requestContext?.correlationId ?? randomUUID(),
        ...(activeSpan === undefined ? {} : { traceId: activeSpan.traceId, spanId: activeSpan.spanId }),
        ...(requestContext?.awsXAmznTraceId === undefined ? {} : { awsAlbTraceId: requestContext.awsXAmznTraceId }),
        ...(requestContext?.awsCloudfrontRequestId === undefined
          ? {}
          : { awsCloudfrontRequestId: requestContext.awsCloudfrontRequestId }),
      },
      this.providers,
    );
    const platform = event.unmapped.platform;
    span?.setAttributes({
      'audit.event_id': event.metadata.uid,
      'audit.outcome': event.status_detail,
      'app.request_id': platform.request_id,
      'app.correlation_id': event.metadata.correlation_uid,
      ...(platform.aws_alb_trace_id === undefined ? {} : { 'aws.alb.trace_id': platform.aws_alb_trace_id }),
      ...(platform.aws_cloudfront_request_id === undefined
        ? {}
        : { 'aws.cloudfront.request_id': platform.aws_cloudfront_request_id }),
    });

    let result: AuditPublishResult;
    try {
      result = await this.publisher.publish(event);
    } catch {
      // Publishers should return a result, but a thrown error must not leak transport detail.
      result = { accepted: false, auditEventId: event.metadata.uid, reason: 'unavailable' };
    }
    if (!result.accepted) {
      this.logger.error('audit.emit.failed', { audit_event_id: event.metadata.uid, failure_reason: result.reason });
      throw new AuditEmissionUnavailableError();
    }

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
