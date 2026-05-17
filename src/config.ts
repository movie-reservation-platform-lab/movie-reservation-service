import { z } from 'zod';

/**
 * Configuration schema using Zod
 *
 * This validates and types environment variables at startup.
 * If validation fails, the app crashes immediately with clear errors.
 */
const configSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    AUTH_MODE: z
      .enum(['local-fixed-user', 'local-jwt', 'oidc'])
      .default('local-fixed-user'),
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
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
  });

/**
 * Parsed and validated config (like a Pydantic model instance)
 *
 * Type is inferred from the schema: z.infer<typeof configSchema>
 * This gives you IDE autocomplete and compile-time type safety.
 */
export const config = configSchema.parse(process.env);

export type AuthMode = typeof config.AUTH_MODE;

/**
 * Export the config type for use elsewhere
 * Usage: import type { Config } from './config'
 */
export type Config = typeof config;
