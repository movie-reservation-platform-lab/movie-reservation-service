/**
 * OpenTelemetry trace propagation helpers.
 *
 * The application logger uses the active span or inbound traceparent to expose a
 * stable `trace_id` log field. Async handoff code uses these helpers to persist
 * concrete propagation headers so workers can continue the original trace.
 */
import { context as otelContext, propagation, trace } from '@opentelemetry/api';

const traceparentPattern = /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i;

export interface ActivePropagationHeaders {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

/** Reads the trace id from the active OpenTelemetry span for log enrichment. */
export function readTraceIdFromActiveSpan(): string | undefined {
  const activeSpan = trace.getActiveSpan();

  if (activeSpan === undefined) {
    return undefined;
  }

  const spanContext = activeSpan.spanContext();

  if (!trace.isSpanContextValid(spanContext)) {
    return undefined;
  }

  return spanContext.traceId;
}

/** Extracts the trace id from a valid W3C traceparent string. */
export function readTraceIdFromTraceparent(traceparent: string | undefined): string | undefined {
  const normalizedTraceparent = normalizeTraceparent(traceparent);

  if (normalizedTraceparent === undefined) {
    return undefined;
  }

  const [, traceId] = normalizedTraceparent.split('-');

  return traceId;
}

/**
 * Reads propagation headers from the active OpenTelemetry context.
 *
 * This is used near async handoff boundaries where the service needs concrete
 * headers to persist or forward, rather than only the in-memory active span.
 */
export function getActivePropagationHeaders(): ActivePropagationHeaders {
  const carrier: Record<string, string> = {};

  propagation.inject(otelContext.active(), carrier);

  return {
    ...readOptionalPropagationField('traceparent', normalizeTraceparent(carrier.traceparent)),
    ...readOptionalPropagationField('tracestate', normalizeOptionalPropagationHeader(carrier.tracestate, 512)),
  };
}

export function normalizeTraceparent(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return traceparentPattern.test(value) ? value.toLowerCase() : undefined;
}

function readOptionalPropagationField<Key extends keyof ActivePropagationHeaders>(
  key: Key,
  value: ActivePropagationHeaders[Key] | undefined,
): Partial<ActivePropagationHeaders> {
  return value === undefined ? {} : { [key]: value };
}

function normalizeOptionalPropagationHeader(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const sanitizedValue = value.replaceAll(/[\r\n]/g, ' ').trim();

  if (sanitizedValue.length === 0 || sanitizedValue.length > maxLength) {
    return undefined;
  }

  return sanitizedValue;
}
