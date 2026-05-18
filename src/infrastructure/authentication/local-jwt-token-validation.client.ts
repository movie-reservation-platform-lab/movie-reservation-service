import { decodeJwt } from 'jose';

import type {
  JwtClaims,
  TokenValidationClient,
} from '../../application/authentication/token-validation-client';
import { AuthenticationError } from '../../domain/authentication/authentication-error';

/**
 * Development-only JWT claims reader.
 *
 * This uses jose to decode the payload of a compact JWT-shaped string so tests
 * and local development can exercise claim mapping. It does not verify
 * signatures, issuer, audience, expiry, or JWKS key rotation.
 */
export class LocalJwtTokenValidationClient implements TokenValidationClient {
  async authenticate(token: string): Promise<JwtClaims> {
    try {
      return decodeJwt(token);
    } catch {
      throw new AuthenticationError('Invalid token');
    }
  }
}
