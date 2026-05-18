import type { AuthenticationManager } from './authentication-manager';
import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';

/**
 * Application service for turning transport auth input into normalized user
 * identity.
 *
 * The service depends on an AuthenticationManager port so the application does
 * not know which auth mode is active.
 *
 * Difference between the manager and service. Service is the orchestrator owned by this
 * codebase, while the manger itself can become external
 *
 */
export class AuthenticationService {
  constructor(private readonly authenticationManager: AuthenticationManager) {}

  async authenticateJwtToken(
    token: string | undefined,
  ): Promise<AuthenticatedUser> {
    return this.authenticationManager.authenticateJwtToken(token);
  }
}
