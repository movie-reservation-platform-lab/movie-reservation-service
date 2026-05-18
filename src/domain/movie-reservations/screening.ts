import type { AuditoriumId } from './auditorium-id';
import type { MovieId } from './movie-id';
import type { MovieProviderId } from './movie-provider-id';
import type { ScreeningId } from './screening-id';

/**
 * Scheduled showing of a movie in an auditorium.
 *
 * `startsAt` and `endsAt` should be ISO 8601 UTC timestamp strings at API and
 * persistence boundaries.
 */
export interface Screening {
  readonly id: ScreeningId;
  readonly movieProviderId: MovieProviderId;
  readonly movieId: MovieId;
  readonly auditoriumId: AuditoriumId;
  readonly startsAt: string;
  readonly endsAt: string;
}
