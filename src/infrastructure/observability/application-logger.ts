/**
 * Structured JSON logging boundary for the service.
 *
 * Application code should log through the small `ApplicationLogger` interface
 * instead of depending on Pino directly. This module owns the operational log
 * contract: stable base fields, event names, request-context enrichment,
 * redaction/sanitization, and the adapter that lets NestJS use the same logger.
 */
import type { LoggerService } from '@nestjs/common';
import pino from 'pino';

import { config } from '../../config';
import { getCurrentRequestContext } from './request-context';
import { readTraceIdFromActiveSpan, readTraceIdFromTraceparent } from './trace-propagation';

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

/**
 * Values allowed as top-level JSON log fields.
 *
 * Keep this intentionally narrow. Logs should carry bounded scalar fields and
 * small string lists, not nested request bodies, GraphQL variables, or arbitrary
 * objects.
 */
export type LogFieldValue = string | number | boolean | null | readonly string[] | undefined;

/**
 * Structured fields supplied by callers before sanitization and contextual
 * enrichment. `undefined` is accepted so callers can build conditional fields
 * without manually pruning them first.
 */
export type LogFields = Readonly<Record<string, LogFieldValue>>;

/**
 * Minimal logging port used by application and presentation code.
 *
 * `event` is the stable machine-readable query key. `message` can be supplied
 * inside `fields` when the event needs human wording; otherwise the event name
 * becomes the message.
 */
export interface ApplicationLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields, error?: unknown): void;
}

/**
 * Pino-ready payload created before the log line is emitted.
 *
 * Keeping this as an explicit type gives tests a seam for verifying enrichment
 * and sanitization without spying on Pino internals.
 */
export interface ApplicationLogPayload {
  readonly fields: LogFields;
  readonly message: string;
}

/**
 * Field names that are never allowed through the application log contract.
 *
 * This is a key-based guard, not a full data-loss-prevention system. Boundary
 * code should still avoid passing secrets, raw headers, request bodies, or
 * GraphQL variables to the logger in the first place.
 */
const forbiddenFieldNames = new Set([
  'authorization',
  'cookie',
  'cookies',
  'headers',
  'raw_headers',
  'request_body',
  'body',
  'variables',
  'graphql_query',
  'database_url',
  'DATABASE_URL',
  'token',
  'access_token',
  'refresh_token',
]);

/**
 * Concrete stdout JSON logger.
 *
 * Container platforms and log scrapers read stdout, while `base` provides the
 * required service identity fields for every emitted line.
 */
const pinoLogger = pino({
  level: config.LOG_LEVEL,
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service_name: config.OTEL_SERVICE_NAME,
    service_version: config.SERVICE_VERSION,
    environment: config.NODE_ENV,
  },
});

/**
 * Process-wide application logger singleton.
 *
 * This keeps callers independent from the concrete Pino API and centralizes the
 * rule that every log line goes through the same payload builder.
 */
export const applicationLogger: ApplicationLogger = {
  debug(event, fields): void {
    writeLog('debug', event, fields);
  },

  info(event, fields): void {
    writeLog('info', event, fields);
  },

  warn(event, fields): void {
    writeLog('warn', event, fields);
  },

  error(event, fields, error): void {
    writeLog('error', event, addErrorFields(fields, error));
  },
};

/**
 * NestJS `LoggerService` adapter backed by the application logger.
 *
 * Nest emits framework lifecycle and error messages through this interface. The
 * adapter maps those messages into structured application log events so Nest
 * output follows the same stdout JSON contract as our own logs.
 */
export class PinoNestLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    applicationLogger.info('nest.log', { message: stringifyMessage(message), code_location: context });
  }

  error(message: unknown, trace?: string, context?: string): void {
    applicationLogger.error('nest.error', {
      message: stringifyMessage(message),
      code_location: context,
      error_stack: trace,
    });
  }

  warn(message: unknown, context?: string): void {
    applicationLogger.warn('nest.warn', { message: stringifyMessage(message), code_location: context });
  }

  debug(message: unknown, context?: string): void {
    applicationLogger.debug('nest.debug', { message: stringifyMessage(message), code_location: context });
  }
}

/**
 * Removes fields that should not be emitted as JSON log attributes.
 *
 * This handles runtime log hygiene: TypeScript can restrict the shape of values
 * at compile time, but it cannot stop a caller from choosing an unsafe field
 * name such as `authorization` or `variables`.
 */
export function sanitizeLogFields(fields: LogFields | undefined): LogFields {
  if (fields === undefined) {
    return {};
  }

  const sanitizedFields: Record<string, Exclude<LogFieldValue, undefined>> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || forbiddenFieldNames.has(key)) {
      continue;
    }

    sanitizedFields[key] = value;
  }

  return sanitizedFields;
}

function writeLog(level: LogLevelName, event: string, fields: LogFields | undefined): void {
  const payload = createApplicationLogPayload(event, fields);

  pinoLogger[level](payload.fields, payload.message);
}

/**
 * Builds the final log payload from caller fields and ambient request context.
 *
 * Request-scoped correlation, trace, user, provider, and GraphQL operation
 * fields are added here so individual call sites do not repeat them.
 * HTTP-only fields such as `request_id`, `http_method`, and `http_route` must
 * still be passed explicitly by the HTTP boundary that owns those facts.
 */
export function createApplicationLogPayload(event: string, fields?: LogFields): ApplicationLogPayload {
  const sanitizedFields = sanitizeLogFields(fields);
  const requestContext = getCurrentRequestContext();
  const traceId = readTraceIdFromActiveSpan() ?? readTraceIdFromTraceparent(requestContext?.traceparent);
  const message = readMessage(sanitizedFields, event);
  const logFields = sanitizeLogFields({
    ...omitMessageField(sanitizedFields),
    event,
    correlation_id: requestContext?.correlationId ?? readStringLogField(sanitizedFields.correlation_id),
    user_id: requestContext?.userId ?? readStringLogField(sanitizedFields.user_id),
    movie_provider_code: requestContext?.movieProviderCode ?? readStringLogField(sanitizedFields.movie_provider_code),
    trace_id: traceId ?? readStringLogField(sanitizedFields.trace_id),
    graphql_operation_name:
      requestContext?.graphqlOperationName ?? readStringLogField(sanitizedFields.graphql_operation_name),
    graphql_operation_type:
      requestContext?.graphqlOperationType ?? readStringLogField(sanitizedFields.graphql_operation_type),
    business_operation: requestContext?.businessOperation ?? readStringLogField(sanitizedFields.business_operation),
  });

  return {
    fields: logFields,
    message,
  };
}

function readStringLogField(value: LogFieldValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function addErrorFields(fields: LogFields | undefined, error: unknown): LogFields {
  if (!(error instanceof Error)) {
    return fields ?? {};
  }

  return {
    ...fields,
    error_type: error.constructor.name,
    error_message: error.message,
    error_stack: error.stack,
  };
}

function omitMessageField(fields: LogFields): LogFields {
  const remainingFields: Record<string, LogFieldValue> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key !== 'message') {
      remainingFields[key] = value;
    }
  }

  return remainingFields;
}

function readMessage(fields: LogFields, event: string): string {
  const message = fields.message;

  return typeof message === 'string' ? message : event;
}

function stringifyMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  return JSON.stringify(message);
}
