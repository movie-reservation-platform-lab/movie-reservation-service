import { type Provider } from '@nestjs/common';

import { AuthenticationService } from '../../application/authentication/authentication.service';
import type { AuthenticationManager } from '../../application/authentication/authentication-manager';
import type { TokenValidationClient } from '../../application/authentication/token-validation-client';
import type { AuthMode } from '../../config';
import { JwtAuthenticationManager } from '../../infrastructure/authentication/jwt-authentication.manager';
import { LocalFixedUserAuthenticationManager } from '../../infrastructure/authentication/local-fixed-user-authentication.manager';
import { LocalJwtTokenValidationClient } from '../../infrastructure/authentication/local-jwt-token-validation.client';
import { AUTHENTICATION_MANAGER, TOKEN_VALIDATION_CLIENT } from './movie-reservation.tokens';

/**
 * Select the authentication adapter for the configured runtime profile.
 */
export function createAuthenticationProviders(authMode: AuthMode): Provider[] {
  if (authMode === 'local-fixed-user') {
    return [
      {
        provide: AUTHENTICATION_MANAGER,
        useFactory: (): AuthenticationManager => new LocalFixedUserAuthenticationManager(),
      },
      createAuthenticationServiceProvider(),
    ];
  }

  if (authMode === 'local-jwt') {
    return [
      {
        provide: TOKEN_VALIDATION_CLIENT,
        useFactory: (): TokenValidationClient => new LocalJwtTokenValidationClient(),
      },
      {
        provide: AUTHENTICATION_MANAGER,
        useFactory: (tokenValidationClient: TokenValidationClient): AuthenticationManager =>
          new JwtAuthenticationManager(tokenValidationClient),
        inject: [TOKEN_VALIDATION_CLIENT],
      },
      createAuthenticationServiceProvider(),
    ];
  }

  throw new Error('OIDC token validation is not implemented yet');
}

/**
 * Connect the application authentication service to the selected manager.
 */
function createAuthenticationServiceProvider(): Provider {
  return {
    provide: AuthenticationService,
    useFactory: (authenticationManager: AuthenticationManager): AuthenticationService =>
      new AuthenticationService(authenticationManager),
    inject: [AUTHENTICATION_MANAGER],
  };
}
