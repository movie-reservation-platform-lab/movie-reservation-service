/**
 * Factory for the initial request observability context.
 *
 * The HTTP middleware owns this boundary because it is the first place where
 * inbound headers, method, and path are available. This module validates and
 * normalizes that raw transport input before the request enters AsyncLocalStorage.
 */
import { randomUUID } from 'node:crypto';

import type { RequestContext } from './request-context';
import { normalizeTraceparent } from './trace-propagation';

const requestIdPattern = /^[A-Za-z0-9._:/@-]{1,128}$/;

/** Raw boundary input from the inbound HTTP request before validation/sanitization. */
export interface IncomingRequestContextInput {
  readonly method?: string;
  readonly path?: string;
  readonly correlationIdHeader: string | readonly string[] | undefined;
  readonly requestIdHeader: string | readonly string[] | undefined;
  readonly traceparentHeader: string | readonly string[] | undefined;
  readonly tracestateHeader: string | readonly string[] | undefined;
  readonly awsXAmznTraceIdHeader: string | readonly string[] | undefined;
}

/**
 * Creates the initial request context at the HTTP boundary.
 *
 * Caller-supplied ids are accepted only when they match a conservative safe id
 * format. Missing or unsafe correlation/request ids are replaced with UUIDs so
 * every request has stable join keys for logs, response headers, and async work.
 */
export function createRequestContext(input: IncomingRequestContextInput): RequestContext {
  return {
    correlationId: normalizeContextId(readFirstHeaderValue(input.correlationIdHeader)),
    requestId: normalizeContextId(readFirstHeaderValue(input.requestIdHeader)),
    ...readOptionalField('method', input.method),
    ...readOptionalField('path', input.path),
    ...readOptionalContextFields(input),
  };
}

function readOptionalContextFields(input: IncomingRequestContextInput): Partial<RequestContext> {
  return {
    ...readOptionalField('traceparent', normalizeTraceparent(readFirstHeaderValue(input.traceparentHeader))),
    ...readOptionalField('tracestate', normalizeOptionalHeaderValue(readFirstHeaderValue(input.tracestateHeader), 512)),
    ...readOptionalField(
      'awsXAmznTraceId',
      normalizeOptionalHeaderValue(readFirstHeaderValue(input.awsXAmznTraceIdHeader), 512),
    ),
  };
}

function readOptionalField<Key extends keyof RequestContext>(
  key: Key,
  value: RequestContext[Key] | undefined,
): Partial<RequestContext> {
  return value === undefined ? {} : { [key]: value };
}

function normalizeContextId(value: string | undefined): string {
  if (value !== undefined && requestIdPattern.test(value)) {
    return value;
  }

  return randomUUID();
}

function normalizeOptionalHeaderValue(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const sanitizedValue = value.replaceAll(/[\r\n]/g, ' ').trim();

  if (sanitizedValue.length === 0 || sanitizedValue.length > maxLength) {
    return undefined;
  }

  return sanitizedValue;
}

function readFirstHeaderValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}
