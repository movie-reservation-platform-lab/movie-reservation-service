export type AuthenticationFailureReason =
  'INVALID_CREDENTIALS' | 'MISSING_CREDENTIALS' | 'MALFORMED_CREDENTIALS' | 'INVALID_TOKEN' | 'UNAUTHENTICATED';

export type AuthenticationOutcome =
  { readonly authenticated: true } | { readonly authenticated: false; readonly reason: AuthenticationFailureReason };

export interface AuthenticationAuditAttempt {
  readonly outcome: AuthenticationOutcome;
  readonly route: '/demo/auth/login' | '/graphql';
  readonly authBoundary: 'demo_login' | 'graphql';
}

export interface AuthenticationAuditEventInput extends AuthenticationAuditAttempt {
  readonly uid: string;
  readonly time: number;
  readonly correlationId: string;
  readonly requestId: string;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly awsAlbTraceId?: string;
  readonly awsCloudfrontRequestId?: string;
}

export interface AuthenticationAuditEvent {
  readonly activity_id: 99;
  readonly activity_name: 'Credential validation';
  readonly category_uid: 3;
  readonly class_uid: 3002;
  readonly type_uid: 300299;
  readonly severity_id: 1 | 2;
  readonly status_id: 1 | 2;
  readonly status_detail: 'AUTHENTICATED' | AuthenticationFailureReason;
  readonly time: number;
  readonly metadata: {
    readonly version: '1.3.0';
    readonly uid: string;
    readonly correlation_uid: string;
    readonly product: {
      readonly name: string;
      readonly vendor_name: 'Movie Reservation Platform Lab';
      readonly version: string;
    };
  };
  readonly service: { readonly name: string; readonly version: string };
  readonly user: { readonly name: 'unknown' | 'demo-user'; readonly type_id: 0 | 1 };
  readonly unmapped: {
    readonly platform: {
      readonly schema_version: '1';
      readonly environment: string;
      readonly request_id: string;
      readonly trace_id?: string;
      readonly span_id?: string;
      readonly aws_alb_trace_id?: string;
      readonly aws_cloudfront_request_id?: string;
      readonly route: '/demo/auth/login' | '/graphql';
      readonly auth_boundary: 'demo_login' | 'graphql';
    };
  };
}

const safeIdentifier = /^[A-Za-z0-9._:/@-]{1,128}$/;
const failureReasons: readonly AuthenticationFailureReason[] = [
  'INVALID_CREDENTIALS',
  'MISSING_CREDENTIALS',
  'MALFORMED_CREDENTIALS',
  'INVALID_TOKEN',
  'UNAUTHENTICATED',
];

/** Pure OCSF mapping. Callers supply time, IDs and context; no framework or SDK imports. */
export function buildAuthenticationAuditEvent(input: AuthenticationAuditEventInput): AuthenticationAuditEvent {
  for (const value of [input.correlationId, input.requestId]) {
    if (!safeIdentifier.test(value)) {
      throw new Error('Audit identifiers must be bounded printable identifiers');
    }
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.uid)) {
    throw new Error('Audit event ID must be a UUID v4');
  }
  if (
    !['movie-reservation-service', 'movie-reservation-agent', 'movie-recommendation-service'].includes(
      input.serviceName,
    )
  ) {
    throw new Error('Unknown audit service');
  }
  for (const value of [input.serviceVersion, input.environment]) {
    if (value.length === 0 || value.length > 128 || /[\p{Cc}\p{Cf}]/u.test(value)) {
      throw new Error('Audit service metadata must be bounded printable text');
    }
  }
  if (!Number.isSafeInteger(input.time) || input.time < 0) {
    throw new Error('Audit time must be epoch milliseconds');
  }
  if (!input.outcome.authenticated && !failureReasons.includes(input.outcome.reason)) {
    throw new Error('Unknown audit failure reason');
  }
  if (!(
    (input.route === '/demo/auth/login' && input.authBoundary === 'demo_login') ||
    (input.route === '/graphql' && input.authBoundary === 'graphql')
  )) {
    throw new Error('Unknown authentication boundary');
  }

  const traceId = normalizeHexId(input.traceId, 32);
  const spanId = traceId === undefined ? undefined : normalizeHexId(input.spanId, 16);
  const albTraceId = sanitizeHeader(input.awsAlbTraceId);
  const cloudfrontRequestId = sanitizeHeader(input.awsCloudfrontRequestId);

  return {
    activity_id: 99,
    activity_name: 'Credential validation',
    category_uid: 3,
    class_uid: 3002,
    type_uid: 300299,
    severity_id: input.outcome.authenticated ? 1 : 2,
    status_id: input.outcome.authenticated ? 1 : 2,
    status_detail: input.outcome.authenticated ? 'AUTHENTICATED' : input.outcome.reason,
    time: input.time,
    metadata: {
      version: '1.3.0',
      uid: input.uid,
      correlation_uid: input.correlationId,
      product: {
        name: input.serviceName,
        vendor_name: 'Movie Reservation Platform Lab',
        version: input.serviceVersion,
      },
    },
    service: { name: input.serviceName, version: input.serviceVersion },
    user: input.outcome.authenticated ? { name: 'demo-user', type_id: 1 } : { name: 'unknown', type_id: 0 },
    unmapped: {
      platform: {
        schema_version: '1',
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
