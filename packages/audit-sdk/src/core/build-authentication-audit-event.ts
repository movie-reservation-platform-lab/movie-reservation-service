import {
  AUDIT_VENDOR_NAME,
  OCSF_VERSION,
  PLATFORM_AUDIT_SCHEMA_VERSION,
  type AuthenticationAuditEvent,
  type AuthenticationAuditEventInput,
} from './authentication-audit-event.js';
import { systemAuditEventProviders, type AuditEventProviders } from './providers.js';
import { assertValidAuthenticationAuditEvent, AuditContractError } from './validation.js';

const allowedInputKeys = new Set([
  'outcome',
  'route',
  'authBoundary',
  'correlationId',
  'requestId',
  'serviceName',
  'serviceVersion',
  'environment',
  'traceId',
  'spanId',
  'awsAlbTraceId',
  'awsCloudfrontRequestId',
]);

export function buildAuthenticationAuditEvent(
  input: AuthenticationAuditEventInput,
  providers: AuditEventProviders = systemAuditEventProviders,
): AuthenticationAuditEvent {
  if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
    throw new AuditContractError([{ code: 'forbidden_field', path: '/' }]);
  }

  const traceId = normalizeHexId(input.traceId, 32);
  const spanId = traceId === undefined ? undefined : normalizeHexId(input.spanId, 16);
  const albTraceId = sanitizeHeader(input.awsAlbTraceId);
  const cloudfrontRequestId = sanitizeHeader(input.awsCloudfrontRequestId);
  const event: AuthenticationAuditEvent = {
    activity_id: 99,
    activity_name: 'Credential validation',
    category_uid: 3,
    class_uid: 3002,
    type_uid: 300299,
    severity_id: input.outcome.authenticated ? 1 : 2,
    status_id: input.outcome.authenticated ? 1 : 2,
    status_detail: input.outcome.authenticated ? 'AUTHENTICATED' : input.outcome.reason,
    time: providers.clock.now(),
    metadata: {
      version: OCSF_VERSION,
      uid: providers.uuid.generate(),
      correlation_uid: input.correlationId,
      product: {
        name: input.serviceName,
        vendor_name: AUDIT_VENDOR_NAME,
        version: input.serviceVersion,
      },
    },
    service: { name: input.serviceName, version: input.serviceVersion },
    user: input.outcome.authenticated ? { name: 'demo-user', type_id: 1 } : { name: 'unknown', type_id: 0 },
    unmapped: {
      platform: {
        schema_version: PLATFORM_AUDIT_SCHEMA_VERSION,
        environment: input.environment,
        request_id: input.requestId,
        ...(traceId === undefined ? {} : { trace_id: traceId }),
        ...(spanId === undefined ? {} : { span_id: spanId }),
        ...(albTraceId === undefined ? {} : { aws_alb_trace_id: albTraceId }),
        ...(cloudfrontRequestId === undefined ? {} : { aws_cloudfront_request_id: cloudfrontRequestId }),
        route: input.route,
        auth_boundary: input.authBoundary,
      },
    },
  };
  assertValidAuthenticationAuditEvent(event);
  return event;
}

function normalizeHexId(value: string | undefined, length: number): string | undefined {
  if (value === undefined || !new RegExp(`^[a-f0-9]{${length}}$`).test(value) || /^0+$/.test(value)) {
    return undefined;
  }
  return value;
}

function sanitizeHeader(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 512) {
    return undefined;
  }
  const sanitized = value.replaceAll(/[^\x20-\x7e]/g, ' ').trim();
  return sanitized.length === 0 ? undefined : sanitized;
}
