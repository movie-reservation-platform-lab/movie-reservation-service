import type {
  ReservationWorkObservabilityContext,
  ReservationWorkObservabilityContextProvider,
} from '../../application/movie-reservations/ports/reservation-work-observability-context-provider';
import { getCurrentReservationWorkObservabilityContext } from './request-context';

export class RequestScopedReservationWorkObservabilityContextProvider implements ReservationWorkObservabilityContextProvider {
  getCurrentContext(): ReservationWorkObservabilityContext | undefined {
    return getCurrentReservationWorkObservabilityContext();
  }
}
