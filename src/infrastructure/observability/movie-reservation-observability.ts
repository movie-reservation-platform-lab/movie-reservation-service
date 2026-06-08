import type {
  MovieReservationObservability,
  ReservationProcessorClaimedAttributes,
  ReservationProcessorOutcomeAttributes,
  ReservationProcessorSpanAttributes,
  ReservationRequestCreatedAttributes,
} from '../../application/movie-reservations/ports/movie-reservation-observability';
import { applicationLogger, type ApplicationLogger } from './application-logger';
import { classifyDiagnosticException } from './metrics/diagnostic-exception-classification';
import {
  incrementReservationProcessorClaims,
  incrementReservationProcessorExceptionCount,
  incrementReservationRequestsCreated,
  recordReservationProcessorOutcomeMetrics,
} from './metrics/reservation-processor-metrics';
import {
  createProcessorClaimedLogFields,
  createProcessorOutcomeLogFields,
  resolveReservationProcessorOutcomeEvent,
} from './reservation-processor-log-fields';
import {
  annotateActiveProcessorClaimedSpan,
  annotateActiveProcessorOutcomeSpan,
  recordActiveProcessorSpanException,
  runReservationProcessorConsumerSpan,
} from './reservation-processor-span-observability';

/**
 * OpenTelemetry/Pino implementation of the reservation observability port.
 *
 * This class is intentionally infrastructure-owned: application services know
 * only the port, while this adapter decides how workflow events become logs,
 * spans, and metrics.
 */
export class OtelMovieReservationObservability implements MovieReservationObservability {
  constructor(private readonly logger: ApplicationLogger = applicationLogger) {}

  recordReservationRequestCreated(attributes: ReservationRequestCreatedAttributes): void {
    incrementReservationRequestsCreated();
    this.logger.info('reservation_request.created', {
      message: 'Reservation request created.',
      business_operation: attributes.businessOperation,
      reservation_request_id: attributes.reservationRequestId,
    });
  }

  async runWithReservationProcessorSpan<T>(
    attributes: ReservationProcessorSpanAttributes,
    operation: () => Promise<T>,
  ): Promise<T> {
    return runReservationProcessorConsumerSpan(attributes, operation);
  }

  recordReservationProcessorClaimed(attributes: ReservationProcessorClaimedAttributes): void {
    incrementReservationProcessorClaims();
    annotateActiveProcessorClaimedSpan(attributes);
    this.logger.info('reservation_request.processing_started', createProcessorClaimedLogFields(attributes));
  }

  recordReservationProcessorOutcome(attributes: ReservationProcessorOutcomeAttributes): void {
    annotateActiveProcessorOutcomeSpan(attributes);
    recordReservationProcessorOutcomeMetrics({
      outcome: attributes.outcome,
      durationMs: attributes.durationMs,
      ...(attributes.reason === undefined ? {} : { reason: attributes.reason }),
    });

    if (attributes.outcome === 'no-pending-request') {
      return;
    }

    this.logger.info(resolveReservationProcessorOutcomeEvent(attributes), createProcessorOutcomeLogFields(attributes));
  }

  recordReservationProcessorException(error: unknown): void {
    recordActiveProcessorSpanException(error);
    incrementReservationProcessorExceptionCount(classifyDiagnosticException(error));
    this.logger.error('reservation_processor.exception', undefined, error);
  }
}
