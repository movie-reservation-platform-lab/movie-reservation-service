import type { MovieProviderId } from './movie-provider-id';

/**
 * Movie provider tenant that owns movies, auditoriums, screenings, and
 * reservations.
 */
export interface MovieProvider {
  readonly id: MovieProviderId;
  readonly code: string;
  readonly name: string;
}
