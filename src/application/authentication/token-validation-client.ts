/**
 * Raw JWT claims after token validation.
 *
 * Claims are intentionally `unknown` values because external tokens are
 * untrusted runtime input until a parser validates the fields the application
 * needs.
 */
export type JwtClaims = Readonly<Record<string, unknown>>;

/**
 * Infrastructure-facing port for token validation.
 *
 * Local development can decode unsigned JWTs behind this interface. Production
 * OIDC should validate signature, issuer, audience, expiry, and key rotation
 * before returning claims.
 */
export interface TokenValidationClient {
  authenticate(token: string): Promise<JwtClaims>;
}
