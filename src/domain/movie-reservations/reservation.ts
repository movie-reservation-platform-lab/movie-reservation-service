import type { UserId } from '../authentication/user-id';
import type { MovieProviderId } from './movie-provider-id';
import type { ReservationId } from './reservation-id';
import type { ReservationRequestId } from './reservation-request-id';
import type { ScreeningId } from './screening-id';
import type { SeatId } from './seat-id';

/**
 * Confirmed seat reservation for a screening.
 *
 * `confirmedAt` should be an ISO 8601 UTC timestamp string at API and
 * persistence boundaries.
 */
export interface Reservation {
  readonly id: ReservationId;
  readonly movieProviderId: MovieProviderId;
  readonly reservationRequestId: ReservationRequestId;
  readonly screeningId: ScreeningId;
  readonly seatIds: readonly SeatId[];
  readonly reservedByUserId: UserId;
  readonly confirmedAt: string;
}
