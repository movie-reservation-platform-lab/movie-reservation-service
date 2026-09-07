import type { AuthenticationOutcome } from '../audit/authentication-audit-event';
import type { AuthenticationAuditRecorder, AuditReceipt } from '../audit/ports/authentication-audit-recorder';

export interface DemoCredentialVerifier {
  matches(username: string, password: string): boolean;
}

export interface DemoLoginResult extends AuditReceipt {
  readonly authenticated: boolean;
  readonly message: 'Invalid credentials' | 'Demo credentials accepted';
}

/** Checks demo credentials only. It does not issue sessions, cookies or API tokens. */
export class DemoLoginService {
  constructor(
    private readonly verifier: DemoCredentialVerifier,
    private readonly audit: AuthenticationAuditRecorder,
  ) {}

  login(body: unknown): DemoLoginResult {
    const outcome = this.authenticate(body);
    const receipt = this.audit.record({ outcome, route: '/demo/auth/login', authBoundary: 'demo_login' });
    return {
      authenticated: outcome.authenticated,
      message: outcome.authenticated ? 'Demo credentials accepted' : 'Invalid credentials',
      ...receipt,
    };
  }

  private authenticate(body: unknown): AuthenticationOutcome {
    if (body === undefined || body === null) {
      return { authenticated: false, reason: 'MISSING_CREDENTIALS' };
    }
    if (typeof body !== 'object' || Array.isArray(body)) {
      return { authenticated: false, reason: 'MALFORMED_CREDENTIALS' };
    }
    const credentials = body as Record<string, unknown>;
    if (credentials.username === undefined || credentials.password === undefined) {
      return { authenticated: false, reason: 'MISSING_CREDENTIALS' };
    }
    if (
      typeof credentials.username !== 'string' ||
      typeof credentials.password !== 'string' ||
      credentials.username.length > 256 ||
      credentials.password.length > 1024
    ) {
      return { authenticated: false, reason: 'MALFORMED_CREDENTIALS' };
    }
    if (credentials.username.length === 0 || credentials.password.length === 0) {
      return { authenticated: false, reason: 'MISSING_CREDENTIALS' };
    }
    if (!this.verifier.matches(credentials.username, credentials.password)) {
      return { authenticated: false, reason: 'INVALID_CREDENTIALS' };
    }
    return { authenticated: true };
  }
}
