export const OCSF_VERSION = '1.3.0' as const;
export const PLATFORM_AUDIT_SCHEMA_VERSION = '1' as const;
export const PLATFORM_AUDIT_CONTRACT_VERSION = 'platform-audit/1' as const;
export const AUDIT_VENDOR_NAME = 'Movie Reservation Platform Lab' as const;

export type AuditServiceName = 'movie-reservation-service' | 'movie-reservation-agent' | 'movie-recommendation-service';

export type AuthenticationFailureReason =
  'INVALID_CREDENTIALS' | 'MISSING_CREDENTIALS' | 'MALFORMED_CREDENTIALS' | 'INVALID_TOKEN' | 'UNAUTHENTICATED';

export type AuthenticationOutcome =
  { readonly authenticated: true } | { readonly authenticated: false; readonly reason: AuthenticationFailureReason };

export type AuthenticationBoundary = 'demo_login' | 'graphql' | 'api_auth';

export interface AuthenticationAuditEventInput {
  readonly outcome: AuthenticationOutcome;
  readonly route: string;
  readonly authBoundary: AuthenticationBoundary;
  readonly correlationId: string;
  readonly requestId: string;
  readonly serviceName: AuditServiceName;
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
    readonly version: typeof OCSF_VERSION;
    readonly uid: string;
    readonly correlation_uid: string;
    readonly product: {
      readonly name: AuditServiceName;
      readonly vendor_name: typeof AUDIT_VENDOR_NAME;
      readonly version: string;
    };
  };
  readonly service: {
    readonly name: AuditServiceName;
    readonly version: string;
  };
  readonly user: {
    readonly name: 'unknown' | 'demo-user';
    readonly type_id: 0 | 1;
  };
  readonly unmapped: {
    readonly platform: {
      readonly schema_version: typeof PLATFORM_AUDIT_SCHEMA_VERSION;
      readonly environment: string;
      readonly request_id: string;
      readonly trace_id?: string;
      readonly span_id?: string;
      readonly aws_alb_trace_id?: string;
      readonly aws_cloudfront_request_id?: string;
      readonly route: string;
      readonly auth_boundary: AuthenticationBoundary;
    };
  };
}
