import { z } from 'zod';

const reservationWorkerModeSchema = z.enum(['disabled', 'fake-in-process']);
const reservationFailureInjectionModeSchema = z.enum(['disabled', 'stable-random-unexpected-error']);
const compositionProfileSchema = z.enum(['local-fixed-user', 'local-jwt', 'local-postgres', 'production-oidc']);

export type AuthMode = 'local-fixed-user' | 'local-jwt' | 'oidc';
export type PersistenceMode = 'in-memory' | 'postgres';
export type ReservationWorkerMode = z.infer<typeof reservationWorkerModeSchema>;
export type ReservationFailureInjectionMode = z.infer<typeof reservationFailureInjectionModeSchema>;
export type CompositionProfile = z.infer<typeof compositionProfileSchema>;

export type ReservationFailureInjection =
  | { readonly mode: Extract<ReservationFailureInjectionMode, 'disabled'> }
  | {
      readonly mode: Extract<ReservationFailureInjectionMode, 'stable-random-unexpected-error'>;
      readonly failureRate: number;
      readonly salt: string;
    };

export interface CompositionProfileDependencyModes {
  readonly authMode: AuthMode;
  readonly persistenceMode: PersistenceMode;
}

/**
 * Composition profiles are finite convenience presets for the core dependency
 * graph. They intentionally own auth and persistence only; orthogonal runtime
 * toggles such as workers and failure injection stay separate.
 */
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
} as const satisfies Record<CompositionProfile, CompositionProfileDependencyModes>;

export function getCompositionProfileDependencyModes(profile: CompositionProfile): CompositionProfileDependencyModes {
  return compositionProfileDependencyModes[profile];
}

interface ReservationFailureInjectionEnvSettings {
  readonly RESERVATION_FAILURE_INJECTION_MODE: ReservationFailureInjectionMode;
  readonly RESERVATION_FAILURE_INJECTION_RATE: number;
  readonly RESERVATION_FAILURE_INJECTION_SALT: string | undefined;
}

function createReservationFailureInjection(
  settings: ReservationFailureInjectionEnvSettings,
): ReservationFailureInjection {
  if (settings.RESERVATION_FAILURE_INJECTION_MODE === 'disabled') {
    return { mode: 'disabled' };
  }

  if (settings.RESERVATION_FAILURE_INJECTION_SALT === undefined) {
    throw new Error('RESERVATION_FAILURE_INJECTION_SALT is required when stable-random failure injection is enabled');
  }

  return {
    mode: 'stable-random-unexpected-error',
    failureRate: settings.RESERVATION_FAILURE_INJECTION_RATE,
    salt: settings.RESERVATION_FAILURE_INJECTION_SALT,
  };
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
    SERVICE_VERSION: z.string().min(1).default('0.1.0'),
    COMPOSITION_PROFILE: compositionProfileSchema.default('local-fixed-user'),
    DATABASE_URL: z.string().url().optional(),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(0),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(5),
    RESERVATION_WORKER_MODE: reservationWorkerModeSchema.default('disabled'),
    RESERVATION_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1).default(250),
    RESERVATION_WORKER_LEASE_MS: z.coerce.number().int().min(1).default(30_000),
    RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1).default(10_000),
    RESERVATION_WORKER_MAX_LEASE_TIMEOUTS: z.coerce.number().int().min(0).default(3),
    RESERVATION_WORKER_MAX_TRANSIENT_FAILURES: z.coerce.number().int().min(1).default(3),
    RESERVATION_FAILURE_INJECTION_MODE: reservationFailureInjectionModeSchema.default('disabled'),
    RESERVATION_FAILURE_INJECTION_RATE: z.coerce.number().min(0).max(1).default(0),
    RESERVATION_FAILURE_INJECTION_SALT: z.string().min(1).optional(),
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    OBSERVABILITY_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default('movie-reservation-service'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_PROTOCOL: z.enum(['http/protobuf', 'grpc']).default('http/protobuf'),
    OTEL_PROPAGATORS: z.string().min(1).default('tracecontext,baggage'),
    OTEL_RESOURCE_ATTRIBUTES: z.string().optional(),
    ENABLE_GRAPHIQL: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .transform((value) => {
    const profileModes = getCompositionProfileDependencyModes(value.COMPOSITION_PROFILE);

    return {
      PORT: value.PORT,
      HOST: value.HOST,
      LOG_LEVEL: value.LOG_LEVEL,
      SERVICE_VERSION: value.SERVICE_VERSION,
      COMPOSITION_PROFILE: value.COMPOSITION_PROFILE,
      AUTH_MODE: profileModes.authMode,
      PERSISTENCE_MODE: profileModes.persistenceMode,
      DATABASE_URL: value.DATABASE_URL,
      DATABASE_POOL_MIN: value.DATABASE_POOL_MIN,
      DATABASE_POOL_MAX: value.DATABASE_POOL_MAX,
      RESERVATION_WORKER_MODE: value.RESERVATION_WORKER_MODE,
      RESERVATION_WORKER_POLL_INTERVAL_MS: value.RESERVATION_WORKER_POLL_INTERVAL_MS,
      RESERVATION_WORKER_LEASE_MS: value.RESERVATION_WORKER_LEASE_MS,
      RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS: value.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS,
      RESERVATION_WORKER_MAX_LEASE_TIMEOUTS: value.RESERVATION_WORKER_MAX_LEASE_TIMEOUTS,
      RESERVATION_WORKER_MAX_TRANSIENT_FAILURES: value.RESERVATION_WORKER_MAX_TRANSIENT_FAILURES,
      RESERVATION_FAILURE_INJECTION_MODE: value.RESERVATION_FAILURE_INJECTION_MODE,
      RESERVATION_FAILURE_INJECTION_RATE: value.RESERVATION_FAILURE_INJECTION_RATE,
      RESERVATION_FAILURE_INJECTION_SALT: value.RESERVATION_FAILURE_INJECTION_SALT,
      NODE_ENV: value.NODE_ENV,
      OBSERVABILITY_ENABLED: value.OBSERVABILITY_ENABLED,
      OTEL_SERVICE_NAME: value.OTEL_SERVICE_NAME,
      OTEL_EXPORTER_OTLP_ENDPOINT: value.OTEL_EXPORTER_OTLP_ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: value.OTEL_EXPORTER_OTLP_PROTOCOL,
      OTEL_PROPAGATORS: value.OTEL_PROPAGATORS,
      OTEL_RESOURCE_ATTRIBUTES: value.OTEL_RESOURCE_ATTRIBUTES,
      ENABLE_GRAPHIQL: value.ENABLE_GRAPHIQL,
    };
  })
  .superRefine((value, context) => {
    if (value.AUTH_MODE.startsWith('local-') && (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production')) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'local auth modes are only allowed in development and test environments',
      });
    }

    if (
      value.RESERVATION_WORKER_MODE === 'fake-in-process' &&
      (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['RESERVATION_WORKER_MODE'],
        message: 'fake-in-process reservation worker is only allowed in development and test environments',
      });
    }

    if (value.PERSISTENCE_MODE === 'postgres' && value.DATABASE_URL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when COMPOSITION_PROFILE selects Postgres persistence',
      });
    }

    if (value.DATABASE_POOL_MAX < value.DATABASE_POOL_MIN) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_POOL_MAX'],
        message: 'DATABASE_POOL_MAX must be greater than or equal to DATABASE_POOL_MIN',
      });
    }

    if (value.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS >= value.RESERVATION_WORKER_LEASE_MS) {
      context.addIssue({
        code: 'custom',
        path: ['RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS'],
        message: 'RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS must be less than RESERVATION_WORKER_LEASE_MS',
      });
    }

    if (value.RESERVATION_FAILURE_INJECTION_MODE === 'disabled' && value.RESERVATION_FAILURE_INJECTION_RATE > 0) {
      context.addIssue({
        code: 'custom',
        path: ['RESERVATION_FAILURE_INJECTION_RATE'],
        message:
          'RESERVATION_FAILURE_INJECTION_RATE must be 0 unless RESERVATION_FAILURE_INJECTION_MODE is stable-random-unexpected-error',
      });
    }

    if (value.RESERVATION_FAILURE_INJECTION_MODE === 'stable-random-unexpected-error') {
      if (value.RESERVATION_FAILURE_INJECTION_RATE <= 0) {
        context.addIssue({
          code: 'custom',
          path: ['RESERVATION_FAILURE_INJECTION_RATE'],
          message:
            'RESERVATION_FAILURE_INJECTION_RATE must be greater than 0 when stable-random failure injection is enabled',
        });
      }

      if (value.RESERVATION_FAILURE_INJECTION_SALT === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['RESERVATION_FAILURE_INJECTION_SALT'],
          message: 'RESERVATION_FAILURE_INJECTION_SALT is required when stable-random failure injection is enabled',
        });
      }
    }
  })
  .transform((value) => {
    const {
      RESERVATION_FAILURE_INJECTION_MODE,
      RESERVATION_FAILURE_INJECTION_RATE,
      RESERVATION_FAILURE_INJECTION_SALT,
      ...rest
    } = value;

    return {
      ...rest,
      RESERVATION_FAILURE_INJECTION: createReservationFailureInjection({
        RESERVATION_FAILURE_INJECTION_MODE,
        RESERVATION_FAILURE_INJECTION_RATE,
        RESERVATION_FAILURE_INJECTION_SALT,
      }),
      ENABLE_GRAPHIQL: value.ENABLE_GRAPHIQL ?? (value.NODE_ENV === 'development' || value.NODE_ENV === 'test'),
      OBSERVABILITY_ENABLED: value.OBSERVABILITY_ENABLED ?? value.NODE_ENV !== 'test',
    };
  });

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
