import { z } from 'zod';

const reservationWorkerModeSchema = z.enum(['disabled', 'fake-in-process']);
const compositionProfileSchema = z.enum([
  'local-fixed-user',
  'local-jwt',
  'local-postgres',
  'production-oidc',
]);

export type AuthMode = 'local-fixed-user' | 'local-jwt' | 'oidc';
export type PersistenceMode = 'in-memory' | 'postgres';
export type ReservationWorkerMode = z.infer<typeof reservationWorkerModeSchema>;
export type CompositionProfile = z.infer<typeof compositionProfileSchema>;

export interface CompositionProfileDependencyModes {
  readonly authMode: AuthMode;
  readonly persistenceMode: PersistenceMode;
}

const compositionProfileDependencyModes = {
  'local-fixed-user': {
    authMode: 'local-fixed-user',
    persistenceMode: 'in-memory',
  },
  'local-jwt': {
    authMode: 'local-jwt',
    persistenceMode: 'in-memory',
  },
  'local-postgres': {
    authMode: 'local-fixed-user',
    persistenceMode: 'postgres',
  },
  'production-oidc': {
    authMode: 'oidc',
    persistenceMode: 'postgres',
  },
} as const satisfies Record<
  CompositionProfile,
  CompositionProfileDependencyModes
>;

export function getCompositionProfileDependencyModes(
  profile: CompositionProfile,
): CompositionProfileDependencyModes {
  return compositionProfileDependencyModes[profile];
}

/**
 * Configuration schema using Zod
 *
 * This validates and types environment variables at startup.
 * If validation fails, the app crashes immediately with clear errors.
 */
const configSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    COMPOSITION_PROFILE: compositionProfileSchema.default('local-fixed-user'),
    DATABASE_URL: z.string().url().optional(),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(0),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(5),
    RESERVATION_WORKER_MODE: reservationWorkerModeSchema.default('disabled'),
    RESERVATION_WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1)
      .default(250),
    RESERVATION_WORKER_LEASE_MS: z.coerce.number().int().min(1).default(30_000),
    RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1)
      .default(10_000),
    RESERVATION_WORKER_MAX_LEASE_TIMEOUTS: z.coerce
      .number()
      .int()
      .min(0)
      .default(3),
    RESERVATION_WORKER_MAX_TRANSIENT_FAILURES: z.coerce
      .number()
      .int()
      .min(1)
      .default(3),
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    ENABLE_GRAPHIQL: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .transform((value) => {
    const profileModes = getCompositionProfileDependencyModes(
      value.COMPOSITION_PROFILE,
    );

    return {
      PORT: value.PORT,
      HOST: value.HOST,
      LOG_LEVEL: value.LOG_LEVEL,
      COMPOSITION_PROFILE: value.COMPOSITION_PROFILE,
      AUTH_MODE: profileModes.authMode,
      PERSISTENCE_MODE: profileModes.persistenceMode,
      DATABASE_URL: value.DATABASE_URL,
      DATABASE_POOL_MIN: value.DATABASE_POOL_MIN,
      DATABASE_POOL_MAX: value.DATABASE_POOL_MAX,
      RESERVATION_WORKER_MODE: value.RESERVATION_WORKER_MODE,
      RESERVATION_WORKER_POLL_INTERVAL_MS:
        value.RESERVATION_WORKER_POLL_INTERVAL_MS,
      RESERVATION_WORKER_LEASE_MS: value.RESERVATION_WORKER_LEASE_MS,
      RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS:
        value.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS,
      RESERVATION_WORKER_MAX_LEASE_TIMEOUTS:
        value.RESERVATION_WORKER_MAX_LEASE_TIMEOUTS,
      RESERVATION_WORKER_MAX_TRANSIENT_FAILURES:
        value.RESERVATION_WORKER_MAX_TRANSIENT_FAILURES,
      NODE_ENV: value.NODE_ENV,
      ENABLE_GRAPHIQL: value.ENABLE_GRAPHIQL,
    };
  })
  .superRefine((value, context) => {
    if (
      value.AUTH_MODE.startsWith('local-') &&
      (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message:
          'local auth modes are only allowed in development and test environments',
      });
    }

    if (
      value.RESERVATION_WORKER_MODE === 'fake-in-process' &&
      (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['RESERVATION_WORKER_MODE'],
        message:
          'fake-in-process reservation worker is only allowed in development and test environments',
      });
    }

    if (
      value.PERSISTENCE_MODE === 'postgres' &&
      value.DATABASE_URL === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message:
          'DATABASE_URL is required when COMPOSITION_PROFILE selects Postgres persistence',
      });
    }

    if (value.DATABASE_POOL_MAX < value.DATABASE_POOL_MIN) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_POOL_MAX'],
        message:
          'DATABASE_POOL_MAX must be greater than or equal to DATABASE_POOL_MIN',
      });
    }

    if (
      value.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS >=
      value.RESERVATION_WORKER_LEASE_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS'],
        message:
          'RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS must be less than RESERVATION_WORKER_LEASE_MS',
      });
    }
  })
  .transform((value) => ({
    ...value,
    ENABLE_GRAPHIQL:
      value.ENABLE_GRAPHIQL ??
      (value.NODE_ENV === 'development' || value.NODE_ENV === 'test'),
  }));

/**
 * Parses and validates config (like building a Pydantic model instance).
 *
 * Type is inferred from the schema: z.infer<typeof configSchema>
 * This gives you IDE autocomplete and compile-time type safety.
 */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  return configSchema.parse(env);
}

export type Config = z.infer<typeof configSchema>;

export const config = parseConfig(process.env);

/**
 * Export the config type for use elsewhere
 * Usage: import type { Config } from './config'
 */
