import type { ReservationRequest } from '../../domain/movie-reservations/reservation-request';
import type { ReservationRequestSequence } from '../../domain/movie-reservations/reservation-request-sequence';

/**
 * Work item returned by the worker-facing repository after an atomic claim.
 */
export interface ClaimedReservationRequest {
  readonly reservationRequest: ReservationRequest;
  readonly sequence: ReservationRequestSequence;
  readonly claimedBy: string;
  readonly claimToken: string;
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
  readonly leaseTimeoutCount: number;
  readonly transientFailureCount: number;
}
