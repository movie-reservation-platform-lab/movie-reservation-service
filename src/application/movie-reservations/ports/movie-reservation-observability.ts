import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import type { ReservationRequestSequence } from '../../../domain/movie-reservations/reservation-request-sequence';
import type { ReservationWorkObservabilityContext } from './reservation-work-observability-context-provider';

/**
 * Bounded operation names used to group movie reservation API logs, spans, and
 * metrics without depending on GraphQL field names.
 */
export type MovieReservationBusinessOperation =
  | 'me'
  | 'movies'
  | 'screenings'
  | 'requestReservation'
  | 'reservationRequestStatus'
  | 'reservationResult'
  | 'unknown';

/**
 * Processor outcomes that are meaningful to operators and support workflows.
 */
export type ReservationProcessorOutcome =
  | 'no-pending-request'
  | 'confirmed'
  | 'rejected'
  | 'retryable-failure'
  | 'failed';

/**
 * Attributes for the API-side event emitted after a reservation request is
 * accepted for asynchronous processing.
 */
export interface ReservationRequestCreatedAttributes {
  readonly reservationRequestId: ReservationRequestId;
  readonly businessOperation: 'requestReservation';
}

/**
 * Attributes for the worker-side event emitted after a processor claims one
 * reservation request.
 */
export interface ReservationProcessorClaimedAttributes {
  readonly reservationRequestId: ReservationRequestId;
  readonly sequence: ReservationRequestSequence;
  readonly observabilityContext?: ReservationWorkObservabilityContext;
}

/**
 * Attributes used to connect worker processing to the trace/log context that
 * was captured when the API created the async work item.
 */
export interface ReservationProcessorSpanAttributes {
  readonly reservationRequestId: ReservationRequestId;
  readonly sequence: ReservationRequestSequence;
  readonly observabilityContext?: ReservationWorkObservabilityContext;
}

/**
 * Shared completion shape for reservation processor logs and metrics.
 */
export interface ReservationProcessorOutcomeAttributes {
  readonly outcome: ReservationProcessorOutcome;
  readonly reservationRequestId?: ReservationRequestId;
  readonly sequence?: ReservationRequestSequence;
  readonly reason?: string;
  readonly durationMs: number;
  readonly observabilityContext?: ReservationWorkObservabilityContext;
}

/**
 * Application-layer observability port for semantic reservation workflow
 * events.
 *
 * Implementations may write logs, spans, and metrics, but application services
 * should depend only on this contract rather than concrete Pino/OpenTelemetry
 * APIs.
 */
export interface MovieReservationObservability {
  /**
   * Records that the API accepted a reservation request and created async work
   * for the processor.
   */
  recordReservationRequestCreated(attributes: ReservationRequestCreatedAttributes): void;

  /**
   * Runs one claimed reservation request inside the processor observability
   * scope, usually a worker/consumer span linked to the original API request.
   */
  runWithReservationProcessorSpan<T>(
    attributes: ReservationProcessorSpanAttributes,
    operation: () => Promise<T>,
  ): Promise<T>;

  /**
   * Records that the processor successfully claimed one pending reservation
   * request for work.
   */
  recordReservationProcessorClaimed(attributes: ReservationProcessorClaimedAttributes): void;

  /**
   * Records the bounded result of one processor attempt, including completion
   * timing and optional reason classification.
   */
  recordReservationProcessorOutcome(attributes: ReservationProcessorOutcomeAttributes): void;

  /**
   * Records an unexpected processor exception. The caller still owns retry,
   * terminal-state, and rethrow decisions.
   */
  recordReservationProcessorException(error: unknown): void;
}
