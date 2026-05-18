import type { MovieId } from './movie-id';
import type { MovieProviderId } from './movie-provider-id';

/**
 * Movie available for scheduling by a movie provider.
 */
export interface Movie {
  readonly id: MovieId;
  readonly movieProviderId: MovieProviderId;
  readonly title: string;
  readonly rating: string;
  readonly durationMinutes: number;
}
