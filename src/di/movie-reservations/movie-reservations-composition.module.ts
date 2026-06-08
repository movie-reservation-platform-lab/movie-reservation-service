import { type DynamicModule, Module, type Provider } from '@nestjs/common';

import { AuthenticationService } from '../../application/authentication/authentication.service';
import { AuthorizationService } from '../../application/authorization/authorization.service';
import { MovieReservationsService } from '../../application/movie-reservations/movie-reservations.service';
import { config, type AuthMode, type PersistenceMode, type ReservationWorkerMode } from '../../config';
import { createAuthenticationProviders } from './authentication.providers';
import {
  CLOCK,
  MOVIE_RESERVATION_OBSERVABILITY,
  MOVIE_RESERVATION_REPOSITORY,
  RESERVATION_ID_GENERATOR,
  RESERVATION_REQUEST_ID_GENERATOR,
  RESERVATION_REQUEST_PROCESSOR,
  RESERVATION_REQUEST_WORK_REPOSITORY,
  RESERVATION_WORK_OBSERVABILITY_CONTEXT_PROVIDER,
} from './movie-reservation.tokens';
import { createPersistenceExports, createPersistenceProviders } from './persistence.providers';
import { createReservationWorkerProviders } from './reservation-worker.providers';
import { createMovieReservationUseCaseProviders } from './use-case.providers';

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
 * Compose the focused provider groups selected by the runtime profile.
 */
function createProviders(options: MovieReservationsCompositionOptions): Provider[] {
  const persistenceMode = options.persistenceMode ?? 'in-memory';
  const reservationWorkerMode = options.reservationWorkerMode ?? config.RESERVATION_WORKER_MODE;

  return [
    ...createAuthenticationProviders(options.authMode),
    ...createPersistenceProviders(persistenceMode),
    ...createMovieReservationUseCaseProviders(),
    ...createReservationWorkerProviders(reservationWorkerMode),
  ];
}

function createExports(persistenceMode: PersistenceMode) {
  return [
    AuthenticationService,
    AuthorizationService,
    CLOCK,
    ...createPersistenceExports(persistenceMode),
    MOVIE_RESERVATION_REPOSITORY,
    MovieReservationsService,
    RESERVATION_ID_GENERATOR,
    MOVIE_RESERVATION_OBSERVABILITY,
    RESERVATION_REQUEST_ID_GENERATOR,
    RESERVATION_REQUEST_PROCESSOR,
    RESERVATION_REQUEST_WORK_REPOSITORY,
    RESERVATION_WORK_OBSERVABILITY_CONTEXT_PROVIDER,
  ];
}
