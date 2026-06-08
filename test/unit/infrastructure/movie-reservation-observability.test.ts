import { describe, expect, it } from 'vitest';

import type { ReservationProcessorOutcomeAttributes } from '../../../src/application/movie-reservations/ports/movie-reservation-observability';
import type { ReservationWorkObservabilityContext } from '../../../src/application/movie-reservations/ports/reservation-work-observability-context-provider';
import { createReservationRequestId } from '../../../src/domain/movie-reservations/reservation-request-id';
import { createReservationRequestSequence } from '../../../src/domain/movie-reservations/reservation-request-sequence';
import type { ApplicationLogger, LogFields } from '../../../src/infrastructure/observability/application-logger';
import { OtelMovieReservationObservability } from '../../../src/infrastructure/observability/movie-reservation-observability';

interface CapturedLogEntry {
  readonly event: string;
  readonly fields?: LogFields;
  readonly error?: unknown;
}

describe('OpenTelemetryMovieReservationObservability', () => {
  it('does not write info logs for empty worker polls', () => {
    const capturedLogger = createCapturedLogger();
    const observability = new OtelMovieReservationObservability(capturedLogger.logger);

    observability.recordReservationProcessorOutcome({
      outcome: 'no-pending-request',
      durationMs: 3,
    });

    expect(capturedLogger.infoMessages).toEqual([]);
  });

  it('logs confirmed reservation requests as explicit business events', () => {
    const capturedLogger = createCapturedLogger();
    const observability = new OtelMovieReservationObservability(capturedLogger.logger);

    observability.recordReservationProcessorOutcome(
      createProcessorOutcomeAttributes({
        outcome: 'confirmed',
      }),
    );

    expect(capturedLogger.infoMessages).toHaveLength(1);

    const confirmedLog = capturedLogger.infoMessages[0];
    const confirmedLogFields = confirmedLog?.fields ?? {};

    expect(confirmedLog?.event).toBe('reservation_request.confirmed');
    expect(confirmedLogFields).toMatchObject({
      message: 'Reservation request confirmed.',
      outcome: 'confirmed',
      duration_ms: 12,
      reservation_request_id: '99999999-9999-4999-8999-999999999901',
      correlation_id: 'booking-correlation-id',
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    expect(confirmedLogFields).not.toHaveProperty('reason_message');
    expect(confirmedLogFields).not.toHaveProperty('reservation_request_sequence');
    expect(confirmedLogFields).not.toHaveProperty('request_id');
    expect(confirmedLogFields).not.toHaveProperty('traceparent');
    expect(confirmedLogFields).not.toHaveProperty('tracestate');
    expect(confirmedLogFields).not.toHaveProperty('parent_span_id');
    expect(confirmedLogFields).not.toHaveProperty('span_id');
    expect(confirmedLogFields).not.toHaveProperty('trace_flags');
  });

  it('logs seat conflicts as explicit rejected reservation events', () => {
    const capturedLogger = createCapturedLogger();
    const observability = new OtelMovieReservationObservability(capturedLogger.logger);

    observability.recordReservationProcessorOutcome(
      createProcessorOutcomeAttributes({
        outcome: 'rejected',
        reason: 'seat-conflict',
      }),
    );

    expect(capturedLogger.infoMessages).toHaveLength(1);

    const rejectedLog = capturedLogger.infoMessages[0];

    expect(rejectedLog?.event).toBe('reservation_request.rejected');
    expect(rejectedLog?.fields).toMatchObject({
      message: 'Reservation request rejected because seats are already booked.',
      outcome: 'rejected',
      reason: 'seat-conflict',
      duration_ms: 12,
      reservation_request_id: '99999999-9999-4999-8999-999999999901',
      correlation_id: 'booking-correlation-id',
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(rejectedLog?.fields).not.toHaveProperty('reason_message');
    expect(rejectedLog?.fields).not.toHaveProperty('reservation_request_sequence');
    expect(rejectedLog?.fields).not.toHaveProperty('request_id');
  });
});

function createProcessorOutcomeAttributes(
  input: Pick<ReservationProcessorOutcomeAttributes, 'outcome'> & {
    readonly reason?: string;
  },
): ReservationProcessorOutcomeAttributes {
  return {
    outcome: input.outcome,
    reservationRequestId: createReservationRequestId('99999999-9999-4999-8999-999999999901'),
    sequence: createReservationRequestSequence(7),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    durationMs: 12,
    observabilityContext: createObservabilityContext(),
  };
}

function createObservabilityContext(): ReservationWorkObservabilityContext {
  return {
    correlationId: 'booking-correlation-id',
    requestId: 'booking-request-id',
    traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    tracestate: 'vendor=value',
  };
}

function createCapturedLogger(): {
  readonly infoMessages: CapturedLogEntry[];
  readonly errorMessages: CapturedLogEntry[];
  readonly logger: ApplicationLogger;
} {
  const infoMessages: CapturedLogEntry[] = [];
  const errorMessages: CapturedLogEntry[] = [];

  return {
    infoMessages,
    errorMessages,
    logger: {
      debug(): void {},
      info(event: string, fields?: LogFields): void {
        infoMessages.push(createCapturedLogEntry(event, fields));
      },
      warn(): void {},
      error(event: string, fields?: LogFields, error?: unknown): void {
        errorMessages.push(createCapturedLogEntry(event, fields, error));
      },
    },
  };
}

function createCapturedLogEntry(event: string, fields?: LogFields, error?: unknown): CapturedLogEntry {
  return {
    event,
    ...(fields === undefined ? {} : { fields }),
    ...(error === undefined ? {} : { error }),
  };
}
