import type { ReservationWorkObservabilityContextProvider } from './ports/reservation-work-observability-context-provider';

/**
 * Empty context provider for tests and direct application-service construction.
 *
 * Runtime composition injects the request-scoped provider. This fallback keeps
 * focused application tests independent from request context storage.
 */
export class EmptyReservationWorkObservabilityContextProvider implements ReservationWorkObservabilityContextProvider {
  getCurrentContext(): undefined {
    return undefined;
  }
}
