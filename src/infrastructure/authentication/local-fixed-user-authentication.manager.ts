import type { AuthenticationManager } from '../../application/authentication/authentication-manager';
import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';
import { createUserId } from '../../domain/authentication/user-id';
import { UserRole } from '../../domain/authentication/user-role';
import { createMovieProviderId } from '../../domain/movie-reservations/movie-provider-id';

/**
 * Development-only authentication manager that always returns the same user.
 *
 * This is useful for fast local GraphQL work without an identity provider. It
 * must not be used for staging or production traffic.
 */
export class LocalFixedUserAuthenticationManager implements AuthenticationManager {
  async authenticateJwtToken(): Promise<AuthenticatedUser> {
    return {
      userId: createUserId('local-dev-user'),
      username: 'local-dev-admin',
      email: 'local-dev@example.test',
      movieProviderId: createMovieProviderId('provider-aurora'),
      roles: [UserRole.TENANT_ADMIN],
      scopes: ['reservations:read:tenant'],
    };
  }
}
