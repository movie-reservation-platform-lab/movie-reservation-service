import type { Knex } from 'knex';

import { createSeatId, type SeatId } from '../../../domain/movie-reservations/seat-id';

/**
 * Rehydrates selected seat ids for a reservation request row.
 */
export async function findReservationRequestSeatIds(
  database: Knex | Knex.Transaction,
  reservationRequestId: string,
): Promise<readonly SeatId[]> {
  const rows = await database<{ readonly seat_id: string }>('reservation_request_seats')
    .select('seat_id')
    .where({ reservation_request_id: reservationRequestId })
    .orderBy('seat_id', 'asc');

  return rows.map((row) => createSeatId(row.seat_id));
}

/**
 * Rehydrates selected seat ids for a confirmed reservation row.
 */
export async function findReservationSeatIds(
  database: Knex | Knex.Transaction,
  reservationId: string,
): Promise<readonly SeatId[]> {
  const rows = await database<{ readonly seat_id: string }>('reservation_seats')
    .select('seat_id')
    .where({ reservation_id: reservationId })
    .orderBy('seat_id', 'asc');

  return rows.map((row) => createSeatId(row.seat_id));
}
