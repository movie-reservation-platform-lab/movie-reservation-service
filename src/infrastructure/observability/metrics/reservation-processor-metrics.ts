import type { ReservationProcessorOutcome } from '../../../application/movie-reservations/ports/movie-reservation-observability';
import type { DiagnosticExceptionType } from './diagnostic-exception-classification';
import { serviceMeter } from './otel-meter';

const reservationRequestCreatedTotal = serviceMeter.createCounter('reservation_request_created_total', {
  description: 'Reservation requests accepted by the API.',
});
const reservationProcessorClaimTotal = serviceMeter.createCounter('reservation_processor_claim_total', {
  description: 'Reservation requests claimed by the processor.',
});
const reservationProcessorOutcomeTotal = serviceMeter.createCounter('reservation_processor_outcome_total', {
  description: 'Reservation processor outcomes.',
});
const reservationProcessorDurationMs = serviceMeter.createHistogram('reservation_processor_duration_ms', {
  description: 'Reservation processor execution duration in milliseconds.',
  unit: 'ms',
});
const reservationProcessorExceptionsTotal = serviceMeter.createCounter('reservation_processor_exceptions_total', {
  description: 'Reservation processor diagnostic exception counts.',
});

const reservationProcessorOutcomes: readonly ReservationProcessorOutcome[] = [
  'no-pending-request',
  'confirmed',
  'rejected',
  'retryable-failure',
  'failed',
];

/**
 * Pre-creates bounded reservation processor outcome metric series.
 *
 * For more information, see: https://prometheus.io/docs/practices/instrumentation/#avoid-missing-metrics
 */
export function initializeReservationProcessorMetricSeries(): void {
  for (const outcome of reservationProcessorOutcomes) {
    reservationProcessorOutcomeTotal.add(0, { outcome });
  }
}

/**
 * Increments the API-side reservation-request-created counter.
 */
export function incrementReservationRequestsCreated(): void {
  reservationRequestCreatedTotal.add(1, { business_operation: 'requestReservation' });
}

/**
 * Increments the worker-side reservation-processor-claimed counter.
 */
export function incrementReservationProcessorClaims(): void {
  reservationProcessorClaimTotal.add(1);
}

/**
 * Records the reservation processor outcome counter and duration sample.
 */
export function recordReservationProcessorOutcomeMetrics(input: {
  readonly outcome: ReservationProcessorOutcome;
  readonly durationMs: number;
  readonly reason?: string;
}): void {
  const attributes = {
    outcome: input.outcome,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };

  reservationProcessorOutcomeTotal.add(1, attributes);
  reservationProcessorDurationMs.record(input.durationMs, attributes);
}

/**
 * Increments the reservation processor diagnostic exception counter.
 */
export function incrementReservationProcessorExceptionCount(exceptionType: DiagnosticExceptionType): void {
  reservationProcessorExceptionsTotal.add(1, { exception_type: exceptionType });
}
