import { type DynamicModule, Module, type Provider } from '@nestjs/common';

import { AuthenticationService } from '../../application/authentication/authentication.service';
import type { AuthenticationManager } from '../../application/authentication/authentication-manager';
import type { TokenValidationClient } from '../../application/authentication/token-validation-client';
import { AuthorizationService } from '../../application/authorization/authorization.service';
import { InProcessReservationRequestProcessor } from '../../application/movie-reservations/in-process-reservation-request-processor';
import { MovieReservationsService } from '../../application/movie-reservations/movie-reservations.service';
import type { Clock } from '../../application/movie-reservations/ports/clock';
import type { MovieReservationRepository } from '../../application/movie-reservations/ports/movie-reservation-repository';
import type { ReservationIdGenerator } from '../../application/movie-reservations/ports/reservation-id-generator';
import type { ReservationRequestIdGenerator } from '../../application/movie-reservations/ports/reservation-request-id-generator';
import type { ReservationRequestProcessor } from '../../application/movie-reservations/ports/reservation-request-processor';
import type { ReservationRequestWorkRepository } from '../../application/movie-reservations/ports/reservation-request-work-repository';
import type { AuthMode } from '../../config';
import { JwtAuthenticationManager } from '../../infrastructure/authentication/jwt-authentication.manager';
import { LocalFixedUserAuthenticationManager } from '../../infrastructure/authentication/local-fixed-user-authentication.manager';
import { LocalJwtTokenValidationClient } from '../../infrastructure/authentication/local-jwt-token-validation.client';
import { RandomReservationIdGenerator } from '../../infrastructure/movie-reservations/random-reservation-id-generator';
import { RandomReservationRequestIdGenerator } from '../../infrastructure/movie-reservations/random-reservation-request-id-generator';
import { SystemClock } from '../../infrastructure/movie-reservations/system-clock';
import { InMemoryMovieReservationRepository } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';
import { InMemoryMovieReservationStore } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.store';
import { InMemoryReservationRequestWorkRepository } from '../../infrastructure/repositories/in-memory/in-memory-reservation-request-work.repository';
import {
  AUTHENTICATION_MANAGER,
  CLOCK,
  IN_MEMORY_MOVIE_RESERVATION_STORE,
  MOVIE_RESERVATION_REPOSITORY,
  RESERVATION_ID_GENERATOR,
  RESERVATION_REQUEST_ID_GENERATOR,
  RESERVATION_REQUEST_PROCESSOR,
  RESERVATION_REQUEST_WORK_REPOSITORY,
  TOKEN_VALIDATION_CLIENT,
} from './movie-reservation.tokens';

export interface MovieReservationsCompositionOptions {
  readonly authMode: AuthMode;
}

/**
 * Main DI composition module for movie reservations
 *
 * Note: Some infrastructure tokens are exported for integration tests and
 * local composition visibility. Presentation code should still depend on
 * application services rather than reaching into these internals.
 */
@Module({})
export class MovieReservationsCompositionModule {
  static forRoot(options: MovieReservationsCompositionOptions): DynamicModule {
    return {
      module: MovieReservationsCompositionModule,
      providers: createProviders(options),
      exports: [
        AuthenticationService,
        AuthorizationService,
        CLOCK,
        IN_MEMORY_MOVIE_RESERVATION_STORE,
        MOVIE_RESERVATION_REPOSITORY,
        MovieReservationsService,
        RESERVATION_ID_GENERATOR,
        RESERVATION_REQUEST_ID_GENERATOR,
        RESERVATION_REQUEST_PROCESSOR,
        RESERVATION_REQUEST_WORK_REPOSITORY,
      ],
    };
  }
}

/**
 * Wire application ports to the current local/in-memory infrastructure
 * implementations.
 */
function createProviders(
  options: MovieReservationsCompositionOptions,
): Provider[] {
  return [
    ...createAuthenticationProviders(options.authMode),
    AuthorizationService,
    {
      provide: IN_MEMORY_MOVIE_RESERVATION_STORE,
      useFactory: (): InMemoryMovieReservationStore =>
        InMemoryMovieReservationStore.withSeedData(),
    },
    {
      provide: MOVIE_RESERVATION_REPOSITORY,
      useFactory: (
        store: InMemoryMovieReservationStore,
      ): MovieReservationRepository =>
        new InMemoryMovieReservationRepository(store),
      inject: [IN_MEMORY_MOVIE_RESERVATION_STORE],
    },
    {
      provide: RESERVATION_REQUEST_WORK_REPOSITORY,
      useFactory: (
        store: InMemoryMovieReservationStore,
      ): ReservationRequestWorkRepository =>
        new InMemoryReservationRequestWorkRepository(store),
      inject: [IN_MEMORY_MOVIE_RESERVATION_STORE],
    },
    {
      provide: RESERVATION_ID_GENERATOR,
      useFactory: (): ReservationIdGenerator =>
        new RandomReservationIdGenerator(),
    },
    {
      provide: RESERVATION_REQUEST_ID_GENERATOR,
      useFactory: (): ReservationRequestIdGenerator =>
        new RandomReservationRequestIdGenerator(),
    },
    {
      provide: CLOCK,
      useFactory: (): Clock => new SystemClock(),
    },
    {
      provide: RESERVATION_REQUEST_PROCESSOR,
      useFactory: (
        workRepository: ReservationRequestWorkRepository,
        reservationIdGenerator: ReservationIdGenerator,
        clock: Clock,
      ): ReservationRequestProcessor =>
        new InProcessReservationRequestProcessor(
          workRepository,
          reservationIdGenerator,
          clock,
        ),
      inject: [
        RESERVATION_REQUEST_WORK_REPOSITORY,
        RESERVATION_ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: MovieReservationsService,
      useFactory: (
        repository: MovieReservationRepository,
        authorizationService: AuthorizationService,
        reservationRequestIdGenerator: ReservationRequestIdGenerator,
      ): MovieReservationsService =>
        new MovieReservationsService(
          repository,
          authorizationService,
          reservationRequestIdGenerator,
        ),
      inject: [
        MOVIE_RESERVATION_REPOSITORY,
        AuthorizationService,
        RESERVATION_REQUEST_ID_GENERATOR,
      ],
    },
  ];
}

/**
 * Select the authentication adapter for the configured runtime profile.
 */
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

/**
 * Connect the application authentication service to the selected manager.
 */
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
