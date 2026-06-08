import {
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';

import type {
  ReservationProcessorClaimedAttributes,
  ReservationProcessorOutcomeAttributes,
  ReservationProcessorSpanAttributes,
} from '../../application/movie-reservations/ports/movie-reservation-observability';
import type { ReservationWorkObservabilityContext } from '../../application/movie-reservations/ports/reservation-work-observability-context-provider';

const reservationProcessorTracer = trace.getTracer('movie-reservation-service.reservation-processor');
const reservationProcessorSpanContextKey = Symbol('movie-reservation-service.reservation-processor-span');

/**
 * Runs async reservation processing inside a consumer span parented to the
 * trace context captured when the API created the work item.
 */
export async function runReservationProcessorConsumerSpan<T>(
  attributes: ReservationProcessorSpanAttributes,
  operation: () => Promise<T>,
): Promise<T> {
  const parentContext = extractProcessorParentContext(attributes.observabilityContext);

  return reservationProcessorTracer.startActiveSpan(
    'reservation_request.process',
    {
      kind: SpanKind.CONSUMER,
      attributes: createProcessorSpanAttributes(attributes),
    },
    parentContext,
    async (span) => {
      const processorContext = otelContext.active().setValue(reservationProcessorSpanContextKey, span);

      return otelContext.with(processorContext, async () => {
        try {
          return await operation();
        } catch (error) {
          recordSpanException(span, error);
          throw error;
        } finally {
          span.end();
        }
      });
    },
  );
}

/**
 * Adds claim metadata to the active processor span when work has been claimed.
 */
export function annotateActiveProcessorClaimedSpan(attributes: ReservationProcessorClaimedAttributes): void {
  const activeSpan = getActiveProcessorSpan();

  if (activeSpan === undefined) {
    return;
  }

  activeSpan.setAttributes(createProcessorSpanAttributes(attributes));
}

/**
 * Adds final processor outcome metadata and status to the active span.
 */
export function annotateActiveProcessorOutcomeSpan(attributes: ReservationProcessorOutcomeAttributes): void {
  const activeSpan = getActiveProcessorSpan();

  if (activeSpan === undefined) {
    return;
  }

  activeSpan.setAttributes({
    ...createOptionalProcessorIdentitySpanAttributes(attributes),
    'reservation_processor.outcome': attributes.outcome,
    'reservation_processor.duration_ms': attributes.durationMs,
    ...(attributes.reason === undefined ? {} : { 'reservation_processor.reason': attributes.reason }),
  });

  if (attributes.outcome === 'failed' || attributes.outcome === 'retryable-failure') {
    activeSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: attributes.reason ?? attributes.outcome,
    });
    return;
  }

  activeSpan.setStatus({ code: SpanStatusCode.OK });
}

/**
 * Records an exception on the active processor span when one exists.
 */
export function recordActiveProcessorSpanException(error: unknown): void {
  const activeSpan = getActiveProcessorSpan();

  if (activeSpan !== undefined) {
    recordSpanException(activeSpan, error);
  }
}

/**
 * Rehydrates the trace context captured when the API created the async work
 * item, so worker processing can continue the same distributed trace.
 */
function extractProcessorParentContext(context: ReservationWorkObservabilityContext | undefined): Context {
  if (context === undefined) {
    return otelContext.active();
  }

  return propagation.extract(otelContext.active(), {
    traceparent: context.traceparent,
    ...(context.tracestate === undefined ? {} : { tracestate: context.tracestate }),
  });
}

/**
 * Builds the common processor span attributes used when the worker starts or
 * later annotates the active processing span.
 */
function createProcessorSpanAttributes(attributes: ReservationProcessorSpanAttributes): Attributes {
  return {
    'reservation_request.id': attributes.reservationRequestId,
    'reservation_request.sequence': attributes.sequence,
    'reservation_processor.operation': 'process',
    'reservation_work_queue.system': 'postgres',
    'reservation_work_queue.name': 'reservation_requests',
    ...createPersistedContextSpanAttributes(attributes.observabilityContext),
  };
}

/**
 * Reads the processor span saved in the active OTel context by
 * `runReservationProcessorConsumerSpan`.
 */
function getActiveProcessorSpan(): Span | undefined {
  return otelContext.active().getValue(reservationProcessorSpanContextKey) as Span | undefined;
}

/**
 * Returns identity attributes only when the outcome event has a concrete work
 * item. The no-pending path has no reservation request id or sequence.
 */
function createOptionalProcessorIdentitySpanAttributes(
  attributes: Pick<ReservationProcessorOutcomeAttributes, 'reservationRequestId' | 'sequence'>,
): Attributes {
  return {
    ...(attributes.reservationRequestId === undefined
      ? {}
      : { 'reservation_request.id': attributes.reservationRequestId }),
    ...(attributes.sequence === undefined ? {} : { 'reservation_request.sequence': attributes.sequence }),
  };
}

/**
 * Keeps persisted async handoff ids visible on spans without logging raw
 * propagation headers.
 */
function createPersistedContextSpanAttributes(context: ReservationWorkObservabilityContext | undefined): Attributes {
  if (context === undefined) {
    return {};
  }

  return {
    'app.correlation_id': context.correlationId,
    'app.request_id': context.requestId,
  };
}

/**
 * Records an exception using OTel's exception shape and marks the span as an
 * error.
 */
function recordSpanException(span: Span, error: unknown): void {
  span.recordException(toSpanException(error));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: readErrorMessage(error),
  });
}

/**
 * OTel accepts either an `Error` object or a string exception description.
 */
function toSpanException(error: unknown): Error | string {
  return error instanceof Error ? error : String(error);
}

/**
 * Normalizes unknown thrown values into a span status message.
 */
function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
