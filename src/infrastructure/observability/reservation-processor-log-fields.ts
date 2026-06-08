import type {
  ReservationProcessorClaimedAttributes,
  ReservationProcessorOutcomeAttributes,
} from '../../application/movie-reservations/ports/movie-reservation-observability';
import type { ReservationWorkObservabilityContext } from '../../application/movie-reservations/ports/reservation-work-observability-context-provider';
import type { ReservationRequestId } from '../../domain/movie-reservations/reservation-request-id';
import type { LogFields } from './application-logger';
import { readTraceIdFromTraceparent } from './trace-propagation';

/**
 * Maps processor outcomes to stable log event names from the log contract.
 */
export function resolveReservationProcessorOutcomeEvent(attributes: ReservationProcessorOutcomeAttributes): string {
  if (attributes.outcome === 'confirmed') {
    return 'reservation_request.confirmed';
  }

  if (attributes.outcome === 'rejected') {
    return 'reservation_request.rejected';
  }

  if (attributes.outcome === 'retryable-failure') {
    return 'reservation_request.processing_retry_scheduled';
  }

  return 'reservation_request.processing_failed';
}

/**
 * Builds the structured log fields for the worker claimed event.
 */
export function createProcessorClaimedLogFields(attributes: ReservationProcessorClaimedAttributes): LogFields {
  return createProcessorLogFields(attributes, {
    message: 'Reservation request processor claimed the request.',
  });
}

/**
 * Builds the structured log fields for processor completion events.
 */
export function createProcessorOutcomeLogFields(attributes: ReservationProcessorOutcomeAttributes): LogFields {
  return createProcessorLogFields(attributes, {
    message: createReservationProcessorMessage(attributes),
    outcome: attributes.outcome,
    reason: attributes.reason,
    duration_ms: attributes.durationMs,
  });
}

/**
 * Adds common async work identifiers and persisted request context to processor
 * log events.
 */
function createProcessorLogFields(
  attributes: {
    readonly reservationRequestId?: ReservationRequestId;
    readonly observabilityContext?: ReservationWorkObservabilityContext;
  },
  fields: LogFields,
): LogFields {
  return {
    ...fields,
    reservation_request_id: attributes.reservationRequestId,
    ...createPersistedContextLogFields(attributes.observabilityContext),
  };
}

/**
 * Converts persisted async handoff context into the small log join keys used by
 * the contract.
 */
function createPersistedContextLogFields(context: ReservationWorkObservabilityContext | undefined): LogFields {
  if (context === undefined) {
    return {};
  }

  return {
    correlation_id: context.correlationId,
    trace_id: readTraceIdFromTraceparent(context.traceparent),
  };
}

/**
 * Produces the human-readable message for reservation processor outcome logs.
 */
function createReservationProcessorMessage(attributes: ReservationProcessorOutcomeAttributes): string {
  if (attributes.outcome === 'confirmed') {
    return 'Reservation request confirmed.';
  }

  if (attributes.reason === 'seat-conflict') {
    return 'Reservation request rejected because seats are already booked.';
  }

  if (attributes.reason === 'unexpected-error') {
    return 'Reservation request processing hit an unexpected internal error.';
  }

  if (attributes.outcome === 'retryable-failure') {
    return 'Reservation request processing will be retried.';
  }

  if (attributes.outcome === 'failed') {
    return 'Reservation request processing failed.';
  }

  return `Reservation request processing completed with outcome ${attributes.outcome}.`;
}
