import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/config';
import { createAppComposition } from '../../../src/di/app-composition';

const serviceRoot = process.cwd();
const runtimeEnvTemplateExpectations = [
  {
    relativePath: 'env_files/templates/local/local-fixed-user.env.template',
    compositionProfile: 'local-fixed-user',
    authMode: 'local-fixed-user',
    persistenceMode: 'in-memory',
    enableGraphiql: true,
    reservationWorkerMode: 'fake-in-process',
    host: '127.0.0.1',
    databaseHost: undefined,
  },
  {
    relativePath: 'env_files/templates/local/local-jwt.env.template',
    compositionProfile: 'local-jwt',
    authMode: 'local-jwt',
    persistenceMode: 'in-memory',
    enableGraphiql: true,
    reservationWorkerMode: 'fake-in-process',
    host: '127.0.0.1',
    databaseHost: undefined,
  },
  {
    relativePath: 'env_files/templates/local/local-postgres.env.template',
    compositionProfile: 'local-postgres',
    authMode: 'local-fixed-user',
    persistenceMode: 'postgres',
    enableGraphiql: true,
    reservationWorkerMode: 'fake-in-process',
    host: '127.0.0.1',
    databaseHost: 'localhost:5432',
  },
  {
    relativePath: 'env_files/templates/in-docker/local-fixed-user.env.template',
    compositionProfile: 'local-fixed-user',
    authMode: 'local-fixed-user',
    persistenceMode: 'in-memory',
    enableGraphiql: true,
    reservationWorkerMode: 'fake-in-process',
    host: '0.0.0.0',
    databaseHost: undefined,
  },
  {
    relativePath: 'env_files/templates/in-docker/local-jwt.env.template',
    compositionProfile: 'local-jwt',
    authMode: 'local-jwt',
    persistenceMode: 'in-memory',
    enableGraphiql: true,
    reservationWorkerMode: 'fake-in-process',
    host: '0.0.0.0',
    databaseHost: undefined,
  },
  {
    relativePath: 'env_files/templates/in-docker/local-postgres.env.template',
    compositionProfile: 'local-postgres',
    authMode: 'local-fixed-user',
    persistenceMode: 'postgres',
    enableGraphiql: true,
    reservationWorkerMode: 'fake-in-process',
    host: '0.0.0.0',
    databaseHost: 'postgres:5432',
  },
  {
    relativePath: 'env_files/templates/platform/production-oidc.env.template',
    compositionProfile: 'production-oidc',
    authMode: 'oidc',
    persistenceMode: 'postgres',
    enableGraphiql: false,
    reservationWorkerMode: 'disabled',
    host: '0.0.0.0',
    databaseHost: undefined,
  },
] as const;

describe('committed service env profile templates', () => {
  /**
   * TODO: These tests are intentionally shallow static checks. They protect the
   * current template defaults, but they are not a good long-term substitute for
   * runtime profile smoke tests that start the app with each profile and verify
   * externally visible behavior.
   */
  it.each(runtimeEnvTemplateExpectations)(
    '%s selects the expected composition profile',
    ({ relativePath, compositionProfile: expectedCompositionProfile }) => {
      const profile = readEnvProfile(relativePath);

      expect(profile.COMPOSITION_PROFILE).toBe(expectedCompositionProfile);
    },
  );

  it.each(runtimeEnvTemplateExpectations)(
    '%s lets the composition profile own auth and persistence mode selection',
    ({ relativePath }) => {
      const profile = readEnvProfile(relativePath);

      expect(profile.AUTH_MODE).toBeUndefined();
      expect(profile.PERSISTENCE_MODE).toBeUndefined();
    },
  );

  it.each(runtimeEnvTemplateExpectations)(
    '%s parses to the expected runtime dependency modes',
    ({
      relativePath,
      authMode,
      persistenceMode,
      enableGraphiql,
      reservationWorkerMode,
      host,
    }) => {
      const config = parseRuntimeEnvTemplate(relativePath);

      expect(config.AUTH_MODE).toBe(authMode);
      expect(config.PERSISTENCE_MODE).toBe(persistenceMode);
      expect(config.ENABLE_GRAPHIQL).toBe(enableGraphiql);
      expect(config.RESERVATION_WORKER_MODE).toBe(reservationWorkerMode);
      expect(config.HOST).toBe(host);
    },
  );
  it.each(
    runtimeEnvTemplateExpectations.filter(
      (expectation) => expectation.databaseHost !== undefined,
    ),
  )('%s selects the expected Postgres hostname', (expectation) => {
    const { relativePath, databaseHost: expectedHost } = expectation;
    if (expectedHost === undefined) {
      throw new Error('template does not define an expected database');
    }

    const profile = readEnvProfile(relativePath);

    expect(profile.DATABASE_URL).toContain(`@${expectedHost}/`);
  });
});

describe('parseConfig persistence settings', () => {
  it('defaults to in-memory persistence without a database URL', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
    });

    expect(config.COMPOSITION_PROFILE).toBe('local-fixed-user');
    expect(config.PERSISTENCE_MODE).toBe('in-memory');
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.DATABASE_POOL_MIN).toBe(0);
    expect(config.DATABASE_POOL_MAX).toBe(5);
  });

  it('requires a database URL for Postgres persistence mode', () => {
    expect(() =>
      parseConfig({
        NODE_ENV: 'test',
        COMPOSITION_PROFILE: 'local-postgres',
      }),
    ).toThrow(
      'DATABASE_URL is required when COMPOSITION_PROFILE selects Postgres persistence',
    );
  });

  it('accepts explicit Postgres pool bounds', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      COMPOSITION_PROFILE: 'local-postgres',
      DATABASE_URL:
        'postgres://movie_reservation_service:test@localhost:5432/movie_reservation_service',
      DATABASE_POOL_MIN: '1',
      DATABASE_POOL_MAX: '3',
    });

    expect(config.DATABASE_POOL_MIN).toBe(1);
    expect(config.DATABASE_POOL_MAX).toBe(3);
  });

  it('rejects a pool max below the pool min', () => {
    expect(() =>
      parseConfig({
        NODE_ENV: 'test',
        COMPOSITION_PROFILE: 'local-postgres',
        DATABASE_URL:
          'postgres://movie_reservation_service:test@localhost:5432/movie_reservation_service',
        DATABASE_POOL_MIN: '4',
        DATABASE_POOL_MAX: '3',
      }),
    ).toThrow(
      'DATABASE_POOL_MAX must be greater than or equal to DATABASE_POOL_MIN',
    );
  });
});

describe('parseConfig composition profile settings', () => {
  it('fills auth and persistence modes from an explicit local JWT profile', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      COMPOSITION_PROFILE: 'local-jwt',
    });

    expect(config.COMPOSITION_PROFILE).toBe('local-jwt');
    expect(config.AUTH_MODE).toBe('local-jwt');
    expect(config.PERSISTENCE_MODE).toBe('in-memory');
  });

  it('ignores stale lower-level env settings because profile owns dependency selection', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      COMPOSITION_PROFILE: 'local-jwt',
      AUTH_MODE: 'local-fixed-user',
      PERSISTENCE_MODE: 'postgres',
    });

    expect(config.AUTH_MODE).toBe('local-jwt');
    expect(config.PERSISTENCE_MODE).toBe('in-memory');
  });
});

describe('parseConfig runtime and worker settings', () => {
  it('binds local development to localhost and keeps the fake worker disabled by default', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
    });

    expect(config.HOST).toBe('127.0.0.1');
    expect(config.RESERVATION_WORKER_MODE).toBe('disabled');
    expect(config.RESERVATION_WORKER_POLL_INTERVAL_MS).toBe(250);
    expect(config.RESERVATION_WORKER_LEASE_MS).toBe(30_000);
    expect(config.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS).toBe(10_000);
    expect(config.RESERVATION_WORKER_MAX_LEASE_TIMEOUTS).toBe(3);
    expect(config.RESERVATION_WORKER_MAX_TRANSIENT_FAILURES).toBe(3);
  });

  it('accepts explicit fake worker settings', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      RESERVATION_WORKER_MODE: 'fake-in-process',
      RESERVATION_WORKER_POLL_INTERVAL_MS: '50',
      RESERVATION_WORKER_LEASE_MS: '1000',
      RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS: '250',
      RESERVATION_WORKER_MAX_LEASE_TIMEOUTS: '2',
      RESERVATION_WORKER_MAX_TRANSIENT_FAILURES: '4',
    });

    expect(config.RESERVATION_WORKER_MODE).toBe('fake-in-process');
    expect(config.RESERVATION_WORKER_POLL_INTERVAL_MS).toBe(50);
    expect(config.RESERVATION_WORKER_LEASE_MS).toBe(1000);
    expect(config.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS).toBe(250);
    expect(config.RESERVATION_WORKER_MAX_LEASE_TIMEOUTS).toBe(2);
    expect(config.RESERVATION_WORKER_MAX_TRANSIENT_FAILURES).toBe(4);
  });

  it('rejects the fake in-process worker in production-like environments', () => {
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        COMPOSITION_PROFILE: 'production-oidc',
        DATABASE_URL:
          'postgres://movie_reservation_service:test@localhost:5432/movie_reservation_service',
        RESERVATION_WORKER_MODE: 'fake-in-process',
      }),
    ).toThrow(
      'fake-in-process reservation worker is only allowed in development and test environments',
    );
  });

  it('rejects a heartbeat interval that cannot renew before lease expiry', () => {
    expect(() =>
      parseConfig({
        NODE_ENV: 'test',
        RESERVATION_WORKER_LEASE_MS: '1000',
        RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS: '1000',
      }),
    ).toThrow(
      'RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS must be less than RESERVATION_WORKER_LEASE_MS',
    );
  });
});

describe('app composition mapping', () => {
  it('maps a profile override to movie reservation module options', () => {
    const composition = createAppComposition(
      { compositionProfile: 'local-jwt' },
      {
        COMPOSITION_PROFILE: 'local-fixed-user',
        AUTH_MODE: 'local-fixed-user',
        PERSISTENCE_MODE: 'in-memory',
        RESERVATION_WORKER_MODE: 'disabled',
      },
    );

    expect(composition.movieReservations).toEqual({
      authMode: 'local-jwt',
      persistenceMode: 'in-memory',
      reservationWorkerMode: 'disabled',
    });
  });

  it('lets focused test overrides replace one dependency choice', () => {
    const composition = createAppComposition(
      { reservationWorkerMode: 'fake-in-process' },
      {
        COMPOSITION_PROFILE: 'local-fixed-user',
        AUTH_MODE: 'local-fixed-user',
        PERSISTENCE_MODE: 'in-memory',
        RESERVATION_WORKER_MODE: 'disabled',
      },
    );

    expect(composition.movieReservations).toEqual({
      authMode: 'local-fixed-user',
      persistenceMode: 'in-memory',
      reservationWorkerMode: 'fake-in-process',
    });
  });
});

function readEnvProfile(relativePath: string): Record<string, string> {
  const profile: Record<string, string> = {};

  for (const line of readFileSync(join(serviceRoot, relativePath), 'utf8')
    .split('\n')
    .filter((profileLine) => {
      return profileLine.length > 0 && !profileLine.startsWith('#');
    })) {
    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    profile[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }

  return profile;
}

function parseRuntimeEnvTemplate(relativePath: string) {
  const env = readEnvProfile(relativePath);

  if (
    env.COMPOSITION_PROFILE === 'production-oidc' &&
    env.DATABASE_URL === undefined
  ) {
    env.DATABASE_URL =
      'postgres://movie_reservation_service:test@localhost:5432/movie_reservation_service';
  }

  return parseConfig(env);
}
