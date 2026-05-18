import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';
import type { UserId } from '../../domain/authentication/user-id';
import type { UserRole } from '../../domain/authentication/user-role';
import type { MovieProviderId } from '../../domain/movie-reservations/movie-provider-id';

/**
 * Minimal request-scoped actor data required by application use cases.
 *
 * This is intentionally narrower than AuthenticatedUser. Middleware may keep
 * the full user for presentation features such as `me`, while use cases should
 * receive only the identity, tenant, role, and scope data they need for
 * business decisions.
 *
 * Keep profile fields such as username and email on AuthenticatedUser unless a
 * use case needs them for an actual business decision.
 */
export interface ActorContext {
  readonly userId: UserId;
  readonly movieProviderId: MovieProviderId;
  readonly roles: readonly UserRole[];
  readonly scopes: readonly string[];
}

/**
 * Derives the use-case actor from the full authenticated user.
 *
 * Arrays are copied because TypeScript `readonly` is compile-time-only; this
 * prevents accidental sharing of mutable array references across boundaries.
 */
export function createActorContext(user: AuthenticatedUser): ActorContext {
  return {
    userId: user.userId,
    movieProviderId: user.movieProviderId,
    roles: [...user.roles],
    scopes: [...user.scopes],
  };
}
