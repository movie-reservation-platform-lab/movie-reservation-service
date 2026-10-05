export type AuthenticationFailureReason =
  'INVALID_CREDENTIALS' | 'MISSING_CREDENTIALS' | 'MALFORMED_CREDENTIALS' | 'INVALID_TOKEN' | 'UNAUTHENTICATED';

export type AuthenticationOutcome =
  { readonly authenticated: true } | { readonly authenticated: false; readonly reason: AuthenticationFailureReason };

/**
 * What the application knows about one authentication decision. Infrastructure
 * maps it, plus request/trace context, into the audit SDK's OCSF event contract.
 */
export interface AuthenticationAuditAttempt {
  readonly outcome: AuthenticationOutcome;
  readonly route: '/demo/auth/login' | '/graphql';
  readonly authBoundary: 'demo_login' | 'graphql';
}
