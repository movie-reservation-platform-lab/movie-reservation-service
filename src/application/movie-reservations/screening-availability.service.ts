import type { ActorContext } from '../authentication/actor-context';
import type { ScreeningId } from '../../domain/movie-reservations/screening-id';
import type { ScreeningAvailabilityReader } from './ports/screening-availability-reader';
import type { ScreeningAvailability } from './screening-availability';

/** Uses trusted actor scope, never a caller-supplied provider identifier. */
export class ScreeningAvailabilityService {
  constructor(private readonly reader: ScreeningAvailabilityReader) {}

  read(actor: ActorContext, screeningId: ScreeningId): Promise<ScreeningAvailability | null> {
    return this.reader.read(actor.movieProviderId, screeningId);
  }
}
