import type { Provider } from '@nestjs/common';
import type { Knex } from 'knex';
import { ScreeningAvailabilityService } from '../../application/movie-reservations/screening-availability.service';
import type { PersistenceMode } from '../../config';
import { InMemoryScreeningAvailabilityReader } from '../../infrastructure/repositories/in-memory/in-memory-screening-availability.reader';
import type { InMemoryMovieReservationStore } from '../../infrastructure/repositories/in-memory/in-memory-movie-reservation.store';
import { PostgresScreeningAvailabilityReader } from '../../infrastructure/repositories/postgres/postgres-screening-availability.reader';
import { IN_MEMORY_MOVIE_RESERVATION_STORE, POSTGRES_KNEX } from './movie-reservation.tokens';

export function createScreeningAvailabilityProviders(mode: PersistenceMode): Provider[] {
  return [
    mode === 'postgres'
      ? {
          provide: ScreeningAvailabilityService,
          useFactory: (database: Knex): ScreeningAvailabilityService =>
            new ScreeningAvailabilityService(new PostgresScreeningAvailabilityReader(database)),
          inject: [POSTGRES_KNEX],
        }
      : {
          provide: ScreeningAvailabilityService,
          useFactory: (store: InMemoryMovieReservationStore): ScreeningAvailabilityService =>
            new ScreeningAvailabilityService(new InMemoryScreeningAvailabilityReader(store)),
          inject: [IN_MEMORY_MOVIE_RESERVATION_STORE],
        },
  ];
}
