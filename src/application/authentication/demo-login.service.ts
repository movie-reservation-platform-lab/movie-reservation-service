import { AuditEmissionUnavailableError } from '../audit/audit-emission-unavailable-error';
import type { AuthenticationOutcome } from '../audit/authentication-audit-attempt';
import type { AuthenticationAuditRecorder, AuditReceipt } from '../audit/ports/authentication-audit-recorder';

export interface DemoCredentialVerifier {
  matches(username: string, password: string): boolean;
}

type DemoLoginDecision =
  | {
      readonly authenticated: true;
      readonly message: 'Demo credentials accepted';
    }
  | {
      readonly authenticated: false;
      readonly message: 'Invalid credentials';
    };

/** The receipt is present only when the audit publisher accepted the event. */
export type DemoLoginResult = DemoLoginDecision | (DemoLoginDecision & AuditReceipt);

/** Checks demo credentials only. It does not issue sessions, cookies or API tokens. */
export class DemoLoginService {
  constructor(
    private readonly verifier: DemoCredentialVerifier,
    private readonly audit: AuthenticationAuditRecorder,
  ) {}

  /**
   * Checks the credentials, then awaits the audit record.
   *
   * - Accepted credentials, audit accepted: accepted result with its receipt.
   * - Accepted credentials, audit unavailable: accepted result without receipt
   *   fields (fail open; the login can exist without an accepted audit event).
   * - Rejected credentials, audit accepted: rejected result with its receipt.
   * - Rejected credentials, audit unavailable: rejected result without receipt
   *   fields; an audit failure must not turn a rejection into an error.
   *
   * When the audit is unavailable, the recorder has already logged
   * `audit.emit.failed` with the correlation fields, and publish metrics count
   * the failure for alerting.
   *
   * TODO(movie-platform-infra#76): put a durable local audit write (transactional
   * outbox, relayed to EventBridge) behind the recorder, so successful logins are
   * audited without waiting for EventBridge. Then revisit failing closed when
   * that local write fails.
   */
  async login(body: unknown): Promise<DemoLoginResult> {
    const outcome = this.authenticate(body);
    const decision: DemoLoginDecision = outcome.authenticated
      ? { authenticated: true, message: 'Demo credentials accepted' }
      : { authenticated: false, message: 'Invalid credentials' };

    try {
      const receipt = await this.audit.record({ outcome, route: '/demo/auth/login', authBoundary: 'demo_login' });
      return { ...decision, ...receipt };
    } catch (error) {
      if (error instanceof AuditEmissionUnavailableError) {
        return decision;
      }

      throw error;
    }
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
