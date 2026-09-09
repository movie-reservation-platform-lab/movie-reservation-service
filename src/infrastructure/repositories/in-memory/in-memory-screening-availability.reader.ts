import type { ScreeningAvailabilityReader } from '../../../application/movie-reservations/ports/screening-availability-reader';
import type { ScreeningAvailability } from '../../../application/movie-reservations/screening-availability';
import type { MovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { InMemoryMovieReservationStore } from './in-memory-movie-reservation.store';

export class InMemoryScreeningAvailabilityReader implements ScreeningAvailabilityReader {
  constructor(private readonly store: InMemoryMovieReservationStore) {}

  async read(movieProviderId: MovieProviderId, screeningId: ScreeningId): Promise<ScreeningAvailability | null> {
    const screening = this.store.screeningsById.get(screeningId);
    if (screening === undefined || screening.movieProviderId !== movieProviderId) return null;

    // Only confirmed reservations occupy a seat. A queued request is not a hold.
    const occupied = new Set(
      [...this.store.reservationsById.values()]
        .filter(
          (reservation) => reservation.movieProviderId === movieProviderId && reservation.screeningId === screeningId,
        )
        .flatMap((reservation) => [...reservation.seatIds]),
    );
    const seats = [...this.store.seatsById.values()]
      .filter((seat) => seat.movieProviderId === movieProviderId && seat.auditoriumId === screening.auditoriumId)
      .map((seat) => ({ seatId: seat.id, available: !occupied.has(seat.id) }));
    return { screeningId, seats };
  }
}
