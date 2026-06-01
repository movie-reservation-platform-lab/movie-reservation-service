import type { MovieProviderId } from '../movie-reservations/movie-provider-id';
import type { UserId } from './user-id';
import type { UserRole } from './user-role';

/**
 * Normalized identity for the current caller.
 *
 * This is the internal shape produced after token claims are parsed.
 * Runtime validation belongs at the token/claims parsing boundary.
 *
 * `movieProviderId` is the current tenant boundary for this service. Use a
 * separate generic tenant id only if platform tenancy and movie-provider
 * ownership become different concepts.
 */
export interface AuthenticatedUser {
  readonly userId: UserId;
  readonly username: string;
  readonly email: string;
  readonly roles: readonly UserRole[];
  readonly scopes: readonly string[];
  readonly movieProviderId: MovieProviderId;
  readonly movieProviderCode?: string;
}
