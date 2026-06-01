import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Knex } from 'knex';

import { POSTGRES_KNEX } from './movie-reservation.tokens';

/**
 * Nest lifecycle bridge that closes the shared Postgres Knex pool on shutdown.
 *
 * The Knex instance is registered as a singleton provider. Without explicitly
 * destroying it, local dev/test processes can keep database sockets open after
 * the Nest application stops.
 */
@Injectable()
export class PostgresKnexLifecycleService implements OnApplicationShutdown {
  constructor(@Inject(POSTGRES_KNEX) private readonly database: Knex) {}

  /**
   * Runs when Nest dispatches application shutdown hooks.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.database.destroy();
  }
}
