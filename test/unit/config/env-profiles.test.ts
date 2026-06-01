import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/config';

const serviceRoot = process.cwd();

describe('committed service env profile templates', () => {
  /**
   * TODO: These tests are intentionally shallow static checks. They protect the
   * current template defaults, but they are not a good long-term substitute for
   * runtime profile smoke tests that start the app with each profile and verify
   * externally visible behavior.
   */
  it.each([
    [
      'env_files/templates/local/local-fixed-user.env.template',
      'local-fixed-user',
    ],
    ['env_files/templates/local/local-jwt.env.template', 'local-jwt'],
    [
      'env_files/templates/local/local-postgres.env.template',
      'local-fixed-user',
    ],
    [
      'env_files/templates/in-docker/local-fixed-user.env.template',
      'local-fixed-user',
    ],
    ['env_files/templates/in-docker/local-jwt.env.template', 'local-jwt'],
    [
      'env_files/templates/in-docker/local-postgres.env.template',
      'local-fixed-user',
    ],
    ['env_files/templates/platform/production-oidc.env.template', 'oidc'],
  ])('%s selects the expected auth mode', (relativePath, expectedAuthMode) => {
    const profile = readEnvProfile(relativePath);

    expect(profile.AUTH_MODE).toBe(expectedAuthMode);
  });

  it.each([
    ['env_files/templates/local/local-fixed-user.env.template', 'true'],
    ['env_files/templates/local/local-jwt.env.template', 'true'],
    ['env_files/templates/local/local-postgres.env.template', 'true'],
    ['env_files/templates/in-docker/local-fixed-user.env.template', 'true'],
    ['env_files/templates/in-docker/local-jwt.env.template', 'true'],
    ['env_files/templates/in-docker/local-postgres.env.template', 'true'],
    ['env_files/templates/platform/production-oidc.env.template', 'false'],
  ])(
    '%s selects the expected GraphiQL exposure',
    (relativePath, expectedEnableGraphiql) => {
      const profile = readEnvProfile(relativePath);

      expect(profile.ENABLE_GRAPHIQL).toBe(expectedEnableGraphiql);
    },
  );

  it.each([
    [
      'env_files/templates/local/local-fixed-user.env.template',
      'fake-in-process',
    ],
    ['env_files/templates/local/local-jwt.env.template', 'fake-in-process'],
    [
      'env_files/templates/local/local-postgres.env.template',
      'fake-in-process',
    ],
    [
      'env_files/templates/in-docker/local-fixed-user.env.template',
      'fake-in-process',
    ],
    ['env_files/templates/in-docker/local-jwt.env.template', 'fake-in-process'],
    [
      'env_files/templates/in-docker/local-postgres.env.template',
      'fake-in-process',
    ],
    ['env_files/templates/platform/production-oidc.env.template', 'disabled'],
  ])('%s selects the expected worker mode', (relativePath, expectedMode) => {
    const profile = readEnvProfile(relativePath);

    expect(profile.RESERVATION_WORKER_MODE).toBe(expectedMode);
  });

  it.each([
    ['env_files/templates/local/local-fixed-user.env.template', '127.0.0.1'],
    ['env_files/templates/local/local-jwt.env.template', '127.0.0.1'],
    ['env_files/templates/local/local-postgres.env.template', '127.0.0.1'],
    ['env_files/templates/in-docker/local-fixed-user.env.template', '0.0.0.0'],
    ['env_files/templates/in-docker/local-jwt.env.template', '0.0.0.0'],
    ['env_files/templates/in-docker/local-postgres.env.template', '0.0.0.0'],
    ['env_files/templates/platform/production-oidc.env.template', '0.0.0.0'],
  ])('%s selects the expected host binding', (relativePath, expectedHost) => {
    const profile = readEnvProfile(relativePath);

    expect(profile.HOST).toBe(expectedHost);
  });

  it.each([
    ['env_files/templates/local/local-postgres.env.template', 'localhost:5432'],
    [
      'env_files/templates/in-docker/local-postgres.env.template',
      'postgres:5432',
    ],
  ])(
    '%s selects the expected Postgres hostname',
    (relativePath, expectedHost) => {
      const profile = readEnvProfile(relativePath);

      expect(profile.DATABASE_URL).toContain(`@${expectedHost}/`);
    },
  );
});

describe('parseConfig persistence settings', () => {
  it('defaults to in-memory persistence without a database URL', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'local-fixed-user',
    });

    expect(config.PERSISTENCE_MODE).toBe('in-memory');
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.DATABASE_POOL_MIN).toBe(0);
    expect(config.DATABASE_POOL_MAX).toBe(5);
  });

  it('requires a database URL for Postgres persistence mode', () => {
    expect(() =>
      parseConfig({
        NODE_ENV: 'test',
        AUTH_MODE: 'local-fixed-user',
        PERSISTENCE_MODE: 'postgres',
      }),
    ).toThrow('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
  });

  it('accepts explicit Postgres pool bounds', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'local-fixed-user',
      PERSISTENCE_MODE: 'postgres',
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
        AUTH_MODE: 'local-fixed-user',
        PERSISTENCE_MODE: 'postgres',
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

describe('parseConfig runtime and worker settings', () => {
  it('binds local development to localhost and keeps the fake worker disabled by default', () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'local-fixed-user',
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
      AUTH_MODE: 'local-fixed-user',
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
        AUTH_MODE: 'oidc',
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
        AUTH_MODE: 'local-fixed-user',
        RESERVATION_WORKER_LEASE_MS: '1000',
        RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS: '1000',
      }),
    ).toThrow(
      'RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS must be less than RESERVATION_WORKER_LEASE_MS',
    );
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
