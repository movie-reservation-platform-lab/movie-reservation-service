import type { Knex } from 'knex';

import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { SeatId } from '../../../domain/movie-reservations/seat-id';
import {
  type ReservationRow,
  type ScreeningRow,
  toReservation,
} from './postgres-mappers';
import { findReservationSeatIds } from './postgres-reservation-seat-lookup';

/**
 * Postgres row operations for confirmed reservations.
 *
 * This helper owns reservation inserts and conflict lookups. The worker
 * repository coordinates when those writes happen, but this class owns the
 * reservation-specific table shape.
 */
export class PostgresReservationStore {
  constructor(private readonly database: Knex) {}

  /**
   * Find an existing confirmed reservation for the same screening and any of
   * the requested seats.
   */
  async findConflictingConfirmedReservation(input: {
    readonly screeningId: ScreeningId;
    readonly seatIds: readonly SeatId[];
  }): Promise<Reservation | null> {
    const reservationSeatRow = await this.database<{
      readonly reservation_id: string;
    }>('reservation_seats')
      .select('reservation_id')
      .where('screening_id', input.screeningId)
      .whereIn('seat_id', input.seatIds)
      .orderBy('reservation_id', 'asc')
      .first();

    if (reservationSeatRow === undefined) {
      return null;
    }

    const row = await this.database<ReservationRow>('reservations')
      .where({ id: reservationSeatRow.reservation_id })
      .first();

    if (row === undefined) {
      throw new Error(
        `Confirmed reservation ${reservationSeatRow.reservation_id} was not found`,
      );
    }

    return toReservation(
      row,
      await findReservationSeatIds(this.database, row.id),
    );
  }

  /**
   * Inserts a confirmed reservation plus its selected seats.
   *
   * The screening lookup supplies the auditorium id required by the composite
   * foreign keys that prevent seats from another auditorium being attached.
   */
  async insertReservation(
    trx: Knex.Transaction,
    reservation: Reservation,
  ): Promise<void> {
    const screeningRow = await this.requireScreeningRowForProvider(
      trx,
      reservation.movieProviderId,
      reservation.screeningId,
    );

    await trx('reservations').insert({
      id: reservation.id,
      movie_provider_id: reservation.movieProviderId,
      reservation_request_id: reservation.reservationRequestId,
      screening_id: reservation.screeningId,
      reserved_by_user_id: reservation.reservedByUserId,
      confirmed_at: reservation.confirmedAt,
    });
    await trx('reservation_seats').insert(
      reservation.seatIds.map((seatId) => ({
        reservation_id: reservation.id,
        movie_provider_id: reservation.movieProviderId,
        screening_id: reservation.screeningId,
        auditorium_id: screeningRow.auditorium_id,
        seat_id: seatId,
      })),
    );
  }

  /**
   * Loads the screening under the same movie provider as the reservation.
   */
  private async requireScreeningRowForProvider(
    trx: Knex.Transaction,
    movieProviderId: string,
    screeningId: string,
  ): Promise<ScreeningRow> {
    const row = await trx<ScreeningRow>('screenings')
      .where({
        id: screeningId,
        movie_provider_id: movieProviderId,
      })
      .first();

    if (row === undefined) {
      throw new Error(`Screening ${screeningId} was not found`);
    }

    return row;
  }
}
