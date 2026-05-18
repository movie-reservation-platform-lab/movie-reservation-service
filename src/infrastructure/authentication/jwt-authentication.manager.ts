import type { AuthenticationManager } from '../../application/authentication/authentication-manager';
import type { TokenValidationClient } from '../../application/authentication/token-validation-client';
import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';
import { AuthenticationError } from '../../domain/authentication/authentication-error';
import { parseMovieReservationClaims } from './movie-reservation-claims-parser';

/**
 * Authentication manager for token-based auth modes.
 *
 * It delegates token validation to a TokenValidationClient, then maps the raw
 * claims into the service's normalized AuthenticatedUser shape.
 */
export class JwtAuthenticationManager implements AuthenticationManager {
  constructor(private readonly tokenValidationClient: TokenValidationClient) {}

  async authenticateJwtToken(
    token: string | undefined,
  ): Promise<AuthenticatedUser> {
    if (token === undefined || token.trim().length === 0) {
      throw new AuthenticationError('Missing token');
    }

    const claims = await this.tokenValidationClient.authenticate(token);
    return parseMovieReservationClaims(claims);
  }
}
