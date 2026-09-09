import type { Knex } from 'knex';
import { z } from 'zod';
import type { ScreeningAvailabilityReader } from '../../../application/movie-reservations/ports/screening-availability-reader';
import type { ScreeningAvailability } from '../../../application/movie-reservations/screening-availability';
import type { MovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import { createSeatId } from '../../../domain/movie-reservations/seat-id';

const availabilityRows = z.array(
  z.object({
    seat_id: z.string().nullable(),
    reserved_seat_id: z.string().nullable(),
  }),
);

export class PostgresScreeningAvailabilityReader implements ScreeningAvailabilityReader {
  constructor(private readonly database: Knex) {}

  async read(movieProviderId: MovieProviderId, screeningId: ScreeningId): Promise<ScreeningAvailability | null> {
    // A single SQL statement gives one MVCC snapshot, including an empty
    // auditorium. An absent/foreign screening instead produces zero rows.
    const result: unknown = await this.database('screenings as sc')
      .leftJoin('seats as s', function joinSeats() {
        this.on('s.movie_provider_id', '=', 'sc.movie_provider_id').andOn('s.auditorium_id', '=', 'sc.auditorium_id');
      })
      .leftJoin('reservation_seats as rs', function joinReservations() {
        this.on('rs.movie_provider_id', '=', 'sc.movie_provider_id')
          .andOn('rs.screening_id', '=', 'sc.id')
          .andOn('rs.seat_id', '=', 's.id');
      })
      .where({ 'sc.movie_provider_id': movieProviderId, 'sc.id': screeningId })
      .select({ seat_id: 's.id', reserved_seat_id: 'rs.seat_id' });
    const rows = availabilityRows.parse(result);
    if (rows.length === 0) return null;
    return {
      screeningId,
      seats: rows.flatMap((row) =>
        row.seat_id === null
          ? []
          : [
              {
                seatId: createSeatId(row.seat_id),
                available: row.reserved_seat_id === null,
              },
            ],
      ),
    };
  }
}
