import type { AuditoriumId } from './auditorium-id';
import type { MovieProviderId } from './movie-provider-id';

/**
 * Physical auditorium owned by a movie provider.
 */
export interface Auditorium {
  readonly id: AuditoriumId;
  readonly movieProviderId: MovieProviderId;
  readonly name: string;
}
