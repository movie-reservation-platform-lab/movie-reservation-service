import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';
import { AuthenticationError } from '../../domain/authentication/authentication-error';
import { createUserId } from '../../domain/authentication/user-id';
import { UserRole } from '../../domain/authentication/user-role';
import { createMovieProviderId } from '../../domain/movie-reservations/movie-provider-id';
import type { JwtClaims } from '../../application/authentication/token-validation-client';

/**
 * Maps untrusted JWT claims into the service's normalized user identity.
 *
 * Token validation libraries can verify JWT structure and signatures, but they
 * do not know this service's domain-specific tenant claim, role vocabulary, or
 * fallback username rules. That mapping belongs here.
 */
export function parseMovieReservationClaims(claims: JwtClaims): AuthenticatedUser {
  const userId = readRequiredStringClaim(claims, 'sub');
  const movieProviderId = readRequiredStringClaim(claims, 'movie_provider_id');
  const movieProviderCode = readOptionalMovieProviderCodeClaim(claims, 'movie_provider_code');
  const username =
    readOptionalStringClaim(claims, 'preferred_username') ?? readOptionalStringClaim(claims, 'name') ?? userId;
  const email = readOptionalStringClaim(claims, 'email') ?? '';

  return {
    userId: createUserId(userId),
    username,
    email,
    movieProviderId: createRequiredMovieProviderIdClaim(movieProviderId),
    ...(movieProviderCode === undefined ? {} : { movieProviderCode }),
    roles: parseRoles(claims),
    scopes: parseScopes(claims),
  };
}

/**
 * Converts the required provider id claim into the domain UUID id type.
 */
function createRequiredMovieProviderIdClaim(value: string) {
  try {
    return createMovieProviderId(value);
  } catch {
    throw new AuthenticationError('Invalid token claims');
  }
}

/**
 * Reads an optional provider code claim used only for display and logging.
 */
function readOptionalMovieProviderCodeClaim(claims: JwtClaims, name: string): string | undefined {
  const value = readOptionalStringClaim(claims, name);

  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmedValue)) {
    throw new AuthenticationError('Invalid token claims');
  }

  return trimmedValue;
}

/**
 * Reads a required non-empty string claim or rejects the token claims.
 */
function readRequiredStringClaim(claims: JwtClaims, name: string): string {
  const value = claims[name];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AuthenticationError('Invalid token claims');
  }

  return value;
}

/**
 * Reads an optional string claim, ignoring non-string claim values.
 */
function readOptionalStringClaim(claims: JwtClaims, name: string): string | undefined {
  const value = claims[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parses the space-delimited OAuth scope claim into individual scopes.
 */
function parseScopes(claims: JwtClaims): readonly string[] {
  const scope = claims.scope;

  if (typeof scope !== 'string') {
    return [];
  }

  return scope.split(' ').filter((value) => value.length > 0);
}

/**
 * Reads Keycloak-style realm/resource roles and keeps service-known roles only.
 */
function parseRoles(claims: JwtClaims): readonly UserRole[] {
  const rawRoles = [...readRealmRoles(claims), ...readResourceRoles(claims)];

  return rawRoles.flatMap((role) => {
    if (isUserRole(role)) {
      return [role];
    }

    return [];
  });
}

/**
 * Reads top-level realm roles from `realm_access.roles`.
 */
function readRealmRoles(claims: JwtClaims): readonly string[] {
  const realmAccess = claims.realm_access;

  if (!isRecord(realmAccess) || !Array.isArray(realmAccess.roles)) {
    return [];
  }

  return realmAccess.roles.filter((role): role is string => {
    return typeof role === 'string';
  });
}

/**
 * Reads client/resource roles from every `resource_access.*.roles` entry.
 */
function readResourceRoles(claims: JwtClaims): readonly string[] {
  const resourceAccess = claims.resource_access;

  if (!isRecord(resourceAccess)) {
    return [];
  }

  return Object.values(resourceAccess).flatMap((resourceRoles) => {
    if (!isRecord(resourceRoles) || !Array.isArray(resourceRoles.roles)) {
      return [];
    }

    return resourceRoles.roles.filter((role): role is string => {
      return typeof role === 'string';
    });
  });
}

/**
 * Runtime guard for JSON object-like JWT claim values.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrows a raw role string to this service's UserRole enum.
 */
function isUserRole(value: string): value is UserRole {
  return Object.values(UserRole).includes(value as UserRole);
}
