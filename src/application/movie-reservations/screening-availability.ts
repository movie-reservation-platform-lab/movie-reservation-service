import type { ScreeningId } from '../../domain/movie-reservations/screening-id';
import type { SeatId } from '../../domain/movie-reservations/seat-id';

/** Public occupancy snapshot. Never includes another customer's identity. */
export interface ScreeningAvailability {
  readonly screeningId: ScreeningId;
  readonly seats: readonly { readonly seatId: SeatId; readonly available: boolean }[];
}
