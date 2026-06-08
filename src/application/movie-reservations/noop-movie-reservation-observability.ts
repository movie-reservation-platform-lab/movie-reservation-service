import type {
  MovieReservationObservability,
  ReservationProcessorSpanAttributes,
} from './ports/movie-reservation-observability';

/**
 * Empty observability adapter for tests and direct application-service
 * construction.
 *
 * Nest composition normally injects the real implementation. This no-op keeps
 * application classes usable in focused tests without making the port file own
 * a concrete implementation.
 */
export class NoopMovieReservationObservability implements MovieReservationObservability {
  recordReservationRequestCreated(): void {}

  async runWithReservationProcessorSpan<T>(
    _attributes: ReservationProcessorSpanAttributes,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  recordReservationProcessorClaimed(): void {}

  recordReservationProcessorOutcome(): void {}

  recordReservationProcessorException(): void {}
}
