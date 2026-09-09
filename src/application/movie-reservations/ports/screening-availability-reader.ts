import type { MovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { ScreeningAvailability } from '../screening-availability';

/** Read-only port; missing and out-of-tenant screenings are indistinguishable. */
export interface ScreeningAvailabilityReader {
  read(movieProviderId: MovieProviderId, screeningId: ScreeningId): Promise<ScreeningAvailability | null>;
}
