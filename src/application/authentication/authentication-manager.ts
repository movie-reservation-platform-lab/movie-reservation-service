import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';

/**
 * Application-facing authentication port.
 *
 * Implementations decide whether the request is authenticated using local
 * fixed-user auth, local JWT claim decoding, or future production OIDC.
 *
 * Difference between the manager and service. Service is the orchestrator owned by this
 * codebase, while the manger itself can become external
 *
 */
export interface AuthenticationManager {
  authenticateJwtToken(token: string | undefined): Promise<AuthenticatedUser>;
}
