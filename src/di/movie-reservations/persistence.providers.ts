import { type DynamicModule, type Provider } from '@nestjs/common';
import knexFactory, { type Knex } from 'knex';

import type { MovieReservationRepository } from '../../application/movie-reservations/ports/movie-reservation-repository';
import type { ReservationRequestWorkRepository } from '../../application/movie-reservations/ports/reservation-request-work-repository';
import { config, type PersistenceMode } from '../../config';
import {
  createKnexConfig,
  createPostgresConnectionSettings,
} from '../../infrastructure/database/knex-config';
import { InMemoryMovieReservationRepository } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';
import { InMemoryMovieReservationStore } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.store';
import { InMemoryReservationRequestWorkRepository } from '../../infrastructure/repositories/in-memory/in-memory-reservation-request-work.repository';
import { PostgresMovieReservationRepository } from '../../infrastructure/repositories/postgres/postgres-movie-reservation.repository';
import { PostgresReservationRequestWorkRepository } from '../../infrastructure/repositories/postgres/postgres-reservation-request-work.repository';
import {
  IN_MEMORY_MOVIE_RESERVATION_STORE,
  MOVIE_RESERVATION_REPOSITORY,
  POSTGRES_KNEX,
  RESERVATION_REQUEST_WORK_REPOSITORY,
} from './movie-reservation.tokens';
import { PostgresKnexLifecycleService } from './postgres-knex-lifecycle.service';

export function createPersistenceProviders(
  persistenceMode: PersistenceMode,
): Provider[] {
  if (persistenceMode === 'postgres') {
    return createPostgresPersistenceProviders();
  }

  return createInMemoryPersistenceProviders();
}

export function createPersistenceExports(
  persistenceMode: PersistenceMode,
): NonNullable<DynamicModule['exports']> {
  return persistenceMode === 'in-memory'
    ? [IN_MEMORY_MOVIE_RESERVATION_STORE]
    : [POSTGRES_KNEX];
}

function createPostgresPersistenceProviders(): Provider[] {
  return [
    {
      provide: POSTGRES_KNEX,
      useFactory: (): Knex =>
        knexFactory(createKnexConfig(createPostgresConnectionSettings(config))),
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

function createInMemoryPersistenceProviders(): Provider[] {
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
