import { type DynamicModule, Module, type Provider } from '@nestjs/common';

import { AuthenticationService } from '../../application/authentication/authentication.service';
import type { AuthenticationManager } from '../../application/authentication/authentication-manager';
import type { TokenValidationClient } from '../../application/authentication/token-validation-client';
import { AuthorizationService } from '../../application/authorization/authorization.service';
import { MovieReservationsService } from '../../application/movie-reservations/movie-reservations.service';
import type { MovieReservationRepository } from '../../application/movie-reservations/ports/movie-reservation-repository';
import type { AuthMode } from '../../config';
import { JwtAuthenticationManager } from '../../infrastructure/authentication/jwt-authentication.manager';
import { LocalFixedUserAuthenticationManager } from '../../infrastructure/authentication/local-fixed-user-authentication.manager';
import { LocalJwtTokenValidationClient } from '../../infrastructure/authentication/local-jwt-token-validation.client';
import { InMemoryMovieReservationRepository } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';
import {
  AUTHENTICATION_MANAGER,
  MOVIE_RESERVATION_REPOSITORY,
  TOKEN_VALIDATION_CLIENT,
} from './movie-reservation.tokens';

export interface MovieReservationsCompositionOptions {
  readonly authMode: AuthMode;
}

@Module({})
export class MovieReservationsCompositionModule {
  static forRoot(options: MovieReservationsCompositionOptions): DynamicModule {
    return {
      module: MovieReservationsCompositionModule,
      providers: createProviders(options),
      exports: [
        AuthenticationService,
        AuthorizationService,
        MOVIE_RESERVATION_REPOSITORY,
        MovieReservationsService,
      ],
    };
  }
}

function createProviders(
  options: MovieReservationsCompositionOptions,
): Provider[] {
  return [
    ...createAuthenticationProviders(options.authMode),
    AuthorizationService,
    {
      provide: MOVIE_RESERVATION_REPOSITORY,
      useFactory: (): MovieReservationRepository =>
        InMemoryMovieReservationRepository.withSeedData(),
    },
    {
      provide: MovieReservationsService,
      useFactory: (
        repository: MovieReservationRepository,
        authorizationService: AuthorizationService,
      ): MovieReservationsService =>
        new MovieReservationsService(repository, authorizationService),
      inject: [MOVIE_RESERVATION_REPOSITORY, AuthorizationService],
    },
  ];
}

function createAuthenticationProviders(authMode: AuthMode): Provider[] {
  if (authMode === 'local-fixed-user') {
    return [
      {
        provide: AUTHENTICATION_MANAGER,
        useFactory: (): AuthenticationManager =>
          new LocalFixedUserAuthenticationManager(),
      },
      createAuthenticationServiceProvider(),
    ];
  }

  if (authMode === 'local-jwt') {
    return [
      {
        provide: TOKEN_VALIDATION_CLIENT,
        useFactory: (): TokenValidationClient =>
          new LocalJwtTokenValidationClient(),
      },
      {
        provide: AUTHENTICATION_MANAGER,
        useFactory: (
          tokenValidationClient: TokenValidationClient,
        ): AuthenticationManager =>
          new JwtAuthenticationManager(tokenValidationClient),
        inject: [TOKEN_VALIDATION_CLIENT],
      },
      createAuthenticationServiceProvider(),
    ];
  }

  throw new Error('OIDC token validation is not implemented yet');
}

function createAuthenticationServiceProvider(): Provider {
  return {
    provide: AuthenticationService,
    useFactory: (
      authenticationManager: AuthenticationManager,
    ): AuthenticationService =>
      new AuthenticationService(authenticationManager),
    inject: [AUTHENTICATION_MANAGER],
  };
}
