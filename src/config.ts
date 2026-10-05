import { z } from 'zod';

import { SERVICE_VERSION } from './service-metadata.js';

const reservationWorkerModeSchema = z.enum(['disabled', 'fake-in-process']);
const reservationFailureInjectionModeSchema = z.enum(['disabled', 'stable-random-unexpected-error']);
const compositionProfileSchema = z.enum(['local-fixed-user', 'local-jwt', 'local-postgres', 'production-oidc']);
const auditPublisherSchema = z.enum(['stdout', 'eventbridge']);

export type AuthMode = 'local-fixed-user' | 'local-jwt' | 'oidc';
export type PersistenceMode = 'in-memory' | 'postgres';
export type ReservationWorkerMode = z.infer<typeof reservationWorkerModeSchema>;
export type ReservationFailureInjectionMode = z.infer<typeof reservationFailureInjectionModeSchema>;
export type CompositionProfile = z.infer<typeof compositionProfileSchema>;

/**
 * Which audit publisher the composition root builds. EventBridge settings exist
 * only on the `eventbridge` variant, so code cannot read a bus ARN for stdout.
 */
export type AuditPublisherSettings =
  | { readonly publisher: 'stdout' }
  | {
      readonly publisher: 'eventbridge';
      readonly eventBusArn: string;
      readonly timeoutMs: number;
      readonly stdoutComparisonMirror: boolean;
    };

export type DemoAuthSettings =
  { readonly enabled: false } | { readonly enabled: true; readonly username: string; readonly password: string };

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
    SERVICE_VERSION: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^\p{Cc}\p{Cf}]+$/u)
      .default(SERVICE_VERSION),
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
    OTEL_SERVICE_NAME: z.string().min(1).default('movie-reservation-service'),
    DEPLOYMENT_ENVIRONMENT: z
      .string()
      .regex(/^[A-Za-z0-9._:/@+-]{1,128}$/)
      .default('local'),
    DEMO_AUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DEMO_AUTH_USERNAME: z.string().max(256).optional(),
    DEMO_AUTH_PASSWORD: z.string().max(1024).optional(),
    AUDIT_PUBLISHER: auditPublisherSchema.default('stdout'),
    AUDIT_EVENT_BUS_ARN: z.string().max(1600).optional(),
    // Same bounds and default as the infrastructure contract (movie-platform-infra PR 7).
    AUDIT_PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(100).max(5_000).default(1_000),
    AUDIT_STDOUT_COMPARISON_MIRROR: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
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
      OTEL_SERVICE_NAME: value.OTEL_SERVICE_NAME,
      DEPLOYMENT_ENVIRONMENT: value.DEPLOYMENT_ENVIRONMENT,
      DEMO_AUTH_ENABLED: value.DEMO_AUTH_ENABLED,
      DEMO_AUTH_USERNAME: value.DEMO_AUTH_USERNAME,
      DEMO_AUTH_PASSWORD: value.DEMO_AUTH_PASSWORD,
      AUDIT_PUBLISHER: value.AUDIT_PUBLISHER,
      AUDIT_EVENT_BUS_ARN: value.AUDIT_EVENT_BUS_ARN,
      AUDIT_PUBLISH_TIMEOUT_MS: value.AUDIT_PUBLISH_TIMEOUT_MS,
      AUDIT_STDOUT_COMPARISON_MIRROR: value.AUDIT_STDOUT_COMPARISON_MIRROR,
      ENABLE_GRAPHIQL: value.ENABLE_GRAPHIQL,
    };
  })
  .superRefine((value, context) => {
    if (value.DEMO_AUTH_ENABLED) {
      if (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production') {
        context.addIssue({
          code: 'custom',
          path: ['DEMO_AUTH_ENABLED'],
          message: 'demo authentication is only allowed in development and test environments',
        });
      }
      for (const key of ['DEMO_AUTH_USERNAME', 'DEMO_AUTH_PASSWORD'] as const) {
        if (value[key] === undefined || value[key]?.trim().length === 0) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when demo authentication is enabled`,
          });
        }
      }
    }

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

    // The bus ARN's exact shape is checked by the SDK when the publisher is composed at startup.
    if (
      value.AUDIT_PUBLISHER === 'eventbridge' &&
      (value.AUDIT_EVENT_BUS_ARN === undefined || value.AUDIT_EVENT_BUS_ARN.trim().length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUDIT_EVENT_BUS_ARN'],
        message: 'AUDIT_EVENT_BUS_ARN is required when AUDIT_PUBLISHER is eventbridge',
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
      DEMO_AUTH_ENABLED,
      DEMO_AUTH_USERNAME,
      DEMO_AUTH_PASSWORD,
      AUDIT_PUBLISHER,
      AUDIT_EVENT_BUS_ARN,
      AUDIT_PUBLISH_TIMEOUT_MS,
      AUDIT_STDOUT_COMPARISON_MIRROR,
      ...rest
    } = value;

    return {
      ...rest,
      DEMO_AUTH: createDemoAuthSettings(DEMO_AUTH_ENABLED, DEMO_AUTH_USERNAME, DEMO_AUTH_PASSWORD),
      AUDIT: createAuditPublisherSettings({
        AUDIT_PUBLISHER,
        AUDIT_EVENT_BUS_ARN,
        AUDIT_PUBLISH_TIMEOUT_MS,
        AUDIT_STDOUT_COMPARISON_MIRROR,
      }),
      RESERVATION_FAILURE_INJECTION: createReservationFailureInjection({
        RESERVATION_FAILURE_INJECTION_MODE,
        RESERVATION_FAILURE_INJECTION_RATE,
        RESERVATION_FAILURE_INJECTION_SALT,
      }),
      ENABLE_GRAPHIQL: value.ENABLE_GRAPHIQL ?? (value.NODE_ENV === 'development' || value.NODE_ENV === 'test'),
    };
  });

function createDemoAuthSettings(
  enabled: boolean,
  username: string | undefined,
  password: string | undefined,
): DemoAuthSettings {
  if (!enabled) {
    return { enabled: false };
  }
  if (username === undefined || password === undefined) {
    throw new Error('Demo authentication requires explicit credentials');
  }
  return { enabled: true, username, password };
}

interface AuditPublisherEnvSettings {
  readonly AUDIT_PUBLISHER: z.infer<typeof auditPublisherSchema>;
  readonly AUDIT_EVENT_BUS_ARN: string | undefined;
  readonly AUDIT_PUBLISH_TIMEOUT_MS: number;
  readonly AUDIT_STDOUT_COMPARISON_MIRROR: boolean;
}

/**
 * Under `stdout`, the EventBridge settings are ignored rather than rejected:
 * infrastructure always injects all four variables, so rolling back must only
 * require switching `AUDIT_PUBLISHER`.
 */
function createAuditPublisherSettings(settings: AuditPublisherEnvSettings): AuditPublisherSettings {
  if (settings.AUDIT_PUBLISHER === 'stdout') {
    return { publisher: 'stdout' };
  }
  if (settings.AUDIT_EVENT_BUS_ARN === undefined) {
    throw new Error('AUDIT_EVENT_BUS_ARN is required when AUDIT_PUBLISHER is eventbridge');
  }
  return {
    publisher: 'eventbridge',
    eventBusArn: settings.AUDIT_EVENT_BUS_ARN,
    timeoutMs: settings.AUDIT_PUBLISH_TIMEOUT_MS,
    stdoutComparisonMirror: settings.AUDIT_STDOUT_COMPARISON_MIRROR,
  };
}

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
