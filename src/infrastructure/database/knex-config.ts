import { join } from 'node:path';

import type { Knex } from 'knex';

import type { Config } from '../../config';

export interface PostgresConnectionSettings {
  readonly databaseUrl: string;
  readonly poolMin: number;
  readonly poolMax: number;
}

export function createPostgresConnectionSettings(
  config: Config,
): PostgresConnectionSettings {
  if (config.DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL is required for Postgres persistence');
  }

  return {
    databaseUrl: config.DATABASE_URL,
    poolMin: config.DATABASE_POOL_MIN,
    poolMax: config.DATABASE_POOL_MAX,
  };
}

export function createKnexConfig(
  settings: PostgresConnectionSettings,
): Knex.Config {
  return {
    client: 'pg',
    connection: settings.databaseUrl,
    pool: {
      min: settings.poolMin,
      max: settings.poolMax,
    },
    migrations: {
      directory: join(__dirname, 'migrations'),
      extension: 'ts',
      loadExtensions: ['.js', '.ts'],
    },
  };
}
