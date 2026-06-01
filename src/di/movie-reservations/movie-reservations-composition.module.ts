import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import knexFactory, { type Knex } from 'knex';

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
import {
  config,
  type AuthMode,
  type PersistenceMode,
  type ReservationWorkerMode,
} from '../../config';
import { JwtAuthenticationManager } from '../../infrastructure/authentication/jwt-authentication.manager';
import { LocalFixedUserAuthenticationManager } from '../../infrastructure/authentication/local-fixed-user-authentication.manager';
import { LocalJwtTokenValidationClient } from '../../infrastructure/authentication/local-jwt-token-validation.client';
import {
  createKnexConfig,
  createPostgresConnectionSettings,
} from '../../infrastructure/database/knex-config';
import { RandomReservationIdGenerator } from '../../infrastructure/movie-reservations/random-reservation-id-generator';
import { RandomReservationRequestIdGenerator } from '../../infrastructure/movie-reservations/random-reservation-request-id-generator';
import { SystemClock } from '../../infrastructure/movie-reservations/system-clock';
import { InMemoryMovieReservationRepository } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';
import { InMemoryMovieReservationStore } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.store';
import { InMemoryReservationRequestWorkRepository } from '../../infrastructure/repositories/in-memory/in-memory-reservation-request-work.repository';
import { PostgresMovieReservationRepository } from '../../infrastructure/repositories/postgres/postgres-movie-reservation.repository';
import { PostgresReservationRequestWorkRepository } from '../../infrastructure/repositories/postgres/postgres-reservation-request-work.repository';
import {
  AUTHENTICATION_MANAGER,
  CLOCK,
  IN_MEMORY_MOVIE_RESERVATION_STORE,
  MOVIE_RESERVATION_REPOSITORY,
  POSTGRES_KNEX,
  RESERVATION_ID_GENERATOR,
  RESERVATION_REQUEST_ID_GENERATOR,
  RESERVATION_REQUEST_PROCESSOR,
  RESERVATION_REQUEST_WORK_REPOSITORY,
  RESERVATION_WORKER_OPTIONS,
  TOKEN_VALIDATION_CLIENT,
} from './movie-reservation.tokens';
import {
  FakeReservationRequestWorkerService,
  type FakeReservationRequestWorkerOptions,
} from './fake-reservation-request-worker.service';
import { PostgresKnexLifecycleService } from './postgres-knex-lifecycle.service';

export interface MovieReservationsCompositionOptions {
  readonly authMode: AuthMode;
  readonly persistenceMode?: PersistenceMode;
  readonly reservationWorkerMode?: ReservationWorkerMode;
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
    const persistenceMode = options.persistenceMode ?? 'in-memory';

    return {
      module: MovieReservationsCompositionModule,
      providers: createProviders(options),
      exports: createExports(persistenceMode),
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
  const persistenceMode = options.persistenceMode ?? 'in-memory';
  const reservationWorkerMode =
    options.reservationWorkerMode ?? config.RESERVATION_WORKER_MODE;

  return [
    ...createAuthenticationProviders(options.authMode),
    AuthorizationService,
    ...createPersistenceProviders(persistenceMode),
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
          {
            workerId: 'fake-in-process-reservation-worker',
            claimLeaseMs: config.RESERVATION_WORKER_LEASE_MS,
            maxLeaseTimeouts: config.RESERVATION_WORKER_MAX_LEASE_TIMEOUTS,
            maxTransientFailures:
              config.RESERVATION_WORKER_MAX_TRANSIENT_FAILURES,
          },
        ),
      inject: [
        RESERVATION_REQUEST_WORK_REPOSITORY,
        RESERVATION_ID_GENERATOR,
        CLOCK,
      ],
    },
    ...createReservationWorkerProviders(reservationWorkerMode),
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

function createReservationWorkerProviders(
  reservationWorkerMode: ReservationWorkerMode,
): Provider[] {
  if (reservationWorkerMode === 'disabled') {
    return [];
  }

  const workerOptions: FakeReservationRequestWorkerOptions = {
    pollIntervalMs: config.RESERVATION_WORKER_POLL_INTERVAL_MS,
    claimLeaseMs: config.RESERVATION_WORKER_LEASE_MS,
    heartbeatIntervalMs: config.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS,
  };

  return [
    {
      provide: RESERVATION_WORKER_OPTIONS,
      useValue: workerOptions,
    },
    FakeReservationRequestWorkerService,
  ];
}

function createPersistenceProviders(
  persistenceMode: PersistenceMode,
): Provider[] {
  if (persistenceMode === 'postgres') {
    return [
      {
        provide: POSTGRES_KNEX,
        useFactory: (): Knex =>
          knexFactory(
            createKnexConfig(createPostgresConnectionSettings(config)),
          ),
      },
      PostgresKnexLifecycleService,
      {
        provide: MOVIE_RESERVATION_REPOSITORY,
        useFactory: (database: Knex): MovieReservationRepository =>
          new PostgresMovieReservationRepository(database),
        inject: [POSTGRES_KNEX],
      },
      {
        provide: RESERVATION_REQUEST_WORK_REPOSITORY,
        useFactory: (database: Knex): ReservationRequestWorkRepository =>
          new PostgresReservationRequestWorkRepository(database),
        inject: [POSTGRES_KNEX],
      },
    ];
  }

  return [
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
  ];
}

function createExports(persistenceMode: PersistenceMode) {
  return [
    AuthenticationService,
    AuthorizationService,
    CLOCK,
    ...(persistenceMode === 'in-memory'
      ? [IN_MEMORY_MOVIE_RESERVATION_STORE]
      : [POSTGRES_KNEX]),
    MOVIE_RESERVATION_REPOSITORY,
    MovieReservationsService,
    RESERVATION_ID_GENERATOR,
    RESERVATION_REQUEST_ID_GENERATOR,
    RESERVATION_REQUEST_PROCESSOR,
    RESERVATION_REQUEST_WORK_REPOSITORY,
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
