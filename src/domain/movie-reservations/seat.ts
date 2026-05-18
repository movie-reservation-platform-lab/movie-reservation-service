import type { AuditoriumId } from './auditorium-id';
import type { MovieProviderId } from './movie-provider-id';
import type { SeatId } from './seat-id';

/**
 * Reservable seat inside a provider-owned auditorium.
 */
export interface Seat {
  readonly id: SeatId;
  readonly movieProviderId: MovieProviderId;
  readonly auditoriumId: AuditoriumId;
  readonly row: string;
  readonly number: number;
}
