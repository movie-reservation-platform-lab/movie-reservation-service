import type { Knex } from 'knex';

import { ReservationRequestAlreadyExistsError } from '../../../application/movie-reservations/errors/reservation-request-already-exists-error';
import type { MovieReservationRepository } from '../../../application/movie-reservations/ports/movie-reservation-repository';
import type { Movie } from '../../../domain/movie-reservations/movie';
import type { MovieId } from '../../../domain/movie-reservations/movie-id';
import type { MovieProvider } from '../../../domain/movie-reservations/movie-provider';
import type { MovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationId } from '../../../domain/movie-reservations/reservation-id';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import type { Screening } from '../../../domain/movie-reservations/screening';
import {
  createScreeningId,
  type ScreeningId,
} from '../../../domain/movie-reservations/screening-id';
import type { Seat } from '../../../domain/movie-reservations/seat';
import {
  createSeatId,
  type SeatId,
} from '../../../domain/movie-reservations/seat-id';
import { isPostgresUniqueViolation } from './postgres-errors';
import {
  type MovieProviderRow,
  type MovieRow,
  type ReservationRequestRow,
  type ReservationRow,
  type ScreeningRow,
  type SeatRow,
  toMovie,
  toMovieProvider,
  toReservation,
  toReservationRequest,
  toScreening,
  toSeat,
} from './postgres-mappers';

export class PostgresMovieReservationRepository implements MovieReservationRepository {
  constructor(private readonly database: Knex) {}

  async findMovieProviderById(
    movieProviderId: MovieProviderId,
  ): Promise<MovieProvider | null> {
    const row = await this.database<MovieProviderRow>('movie_providers')
      .where({ id: movieProviderId })
      .first();

    return row === undefined ? null : toMovieProvider(row);
  }

  async findMoviesByProviderId(
    movieProviderId: MovieProviderId,
  ): Promise<readonly Movie[]> {
    const rows = await this.database<MovieRow>('movies')
      .where({ movie_provider_id: movieProviderId })
      .orderBy('id', 'asc');

    return rows.map(toMovie);
  }

  async findMovieById(
    movieProviderId: MovieProviderId,
    movieId: MovieId,
  ): Promise<Movie | null> {
    const row = await this.database<MovieRow>('movies')
      .where({ id: movieId, movie_provider_id: movieProviderId })
      .first();

    return row === undefined ? null : toMovie(row);
  }

  async findScreeningsByProviderId(
    movieProviderId: MovieProviderId,
    input: { readonly movieId?: MovieId } = {},
  ): Promise<readonly Screening[]> {
    const query = this.database<ScreeningRow>('screenings').where({
      movie_provider_id: movieProviderId,
    });

    if (input.movieId !== undefined) {
      query.andWhere({ movie_id: input.movieId });
    }

    const rows = await query.orderBy('starts_at', 'asc');

    return rows.map(toScreening);
  }

  async findScreeningForProvider(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<Screening | null> {
    const row = await this.database<ScreeningRow>('screenings')
      .where({ id: screeningId, movie_provider_id: movieProviderId })
      .first();

    return row === undefined ? null : toScreening(row);
  }

  async findSeatsByScreeningId(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<readonly Seat[]> {
    const screening = await this.findScreeningForProvider(
      movieProviderId,
      screeningId,
    );

    if (screening === null) {
      return [];
    }

    const rows = await this.database<SeatRow>('seats')
      .where({
        movie_provider_id: movieProviderId,
        auditorium_id: screening.auditoriumId,
      })
      .orderBy('row_label', 'asc')
      .orderBy('seat_number', 'asc');

    return rows.map(toSeat);
  }

  async findSeatsByScreeningIds(
    movieProviderId: MovieProviderId,
    screeningIds: readonly ScreeningId[],
  ): Promise<ReadonlyMap<ScreeningId, readonly Seat[]>> {
    const seatsByScreeningId = new Map<ScreeningId, readonly Seat[]>();

    if (screeningIds.length === 0) {
      return seatsByScreeningId;
    }

    const screenings = await this.database<ScreeningRow>('screenings')
      .where({ movie_provider_id: movieProviderId })
      .whereIn('id', screeningIds);
    const auditoriumIds = [
      ...new Set(screenings.map((screening) => screening.auditorium_id)),
    ];
    const seats =
      auditoriumIds.length === 0
        ? []
        : await this.database<SeatRow>('seats')
            .where({ movie_provider_id: movieProviderId })
            .whereIn('auditorium_id', auditoriumIds)
            .orderBy('row_label', 'asc')
            .orderBy('seat_number', 'asc');
    const seatsByAuditoriumId = new Map<string, Seat[]>();

    for (const seatRow of seats) {
      const auditoriumSeats =
        seatsByAuditoriumId.get(seatRow.auditorium_id) ?? [];
      auditoriumSeats.push(toSeat(seatRow));
      seatsByAuditoriumId.set(seatRow.auditorium_id, auditoriumSeats);
    }

    for (const screening of screenings) {
      seatsByScreeningId.set(
        createScreeningId(screening.id),
        seatsByAuditoriumId.get(screening.auditorium_id) ?? [],
      );
    }

    return seatsByScreeningId;
  }

  async findSeatsByIdsForScreening(
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
    seatIds: readonly SeatId[],
  ): Promise<readonly Seat[]> {
    if (seatIds.length === 0) {
      return [];
    }

    const rows = await this.database<SeatRow>('seats')
      .join<ScreeningRow>('screenings', function joinScreeningAuditorium() {
        this.on('screenings.auditorium_id', '=', 'seats.auditorium_id').andOn(
          'screenings.movie_provider_id',
          '=',
          'seats.movie_provider_id',
        );
      })
      .select<SeatRow[]>('seats.*')
      .where('screenings.movie_provider_id', movieProviderId)
      .where('screenings.id', screeningId)
      .whereIn('seats.id', seatIds)
      .orderBy('seats.row_label', 'asc')
      .orderBy('seats.seat_number', 'asc');

    return rows.map(toSeat);
  }

  async findReservationRequestById(
    reservationRequestId: ReservationRequestId,
  ): Promise<ReservationRequest | null> {
    const row = await this.database<ReservationRequestRow>(
      'reservation_requests',
    )
      .where({ id: reservationRequestId })
      .first();

    if (row === undefined) {
      return null;
    }

    return toReservationRequest(
      row,
      await this.findReservationRequestSeatIds(reservationRequestId),
    );
  }

  async saveReservationRequest(
    reservationRequest: ReservationRequest,
  ): Promise<void> {
    try {
      await this.database.transaction(async (trx) => {
        const screeningRow = await this.requireScreeningRowForProvider(
          trx,
          reservationRequest.movieProviderId,
          reservationRequest.screeningId,
        );
        const now = trx.fn.now();

        await trx('reservation_requests').insert({
          id: reservationRequest.id,
          movie_provider_id: reservationRequest.movieProviderId,
          screening_id: reservationRequest.screeningId,
          requested_by_user_id: reservationRequest.requestedByUserId,
          status: reservationRequest.status,
          requested_at: now,
          updated_at: now,
        });
        await trx('reservation_request_seats').insert(
          reservationRequest.seatIds.map((seatId) => ({
            reservation_request_id: reservationRequest.id,
            movie_provider_id: reservationRequest.movieProviderId,
            screening_id: reservationRequest.screeningId,
            auditorium_id: screeningRow.auditorium_id,
            seat_id: seatId,
          })),
        );
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error, 'reservation_requests_pkey')) {
        throw new ReservationRequestAlreadyExistsError(reservationRequest.id);
      }

      throw error;
    }
  }

  async findReservationById(
    reservationId: ReservationId,
  ): Promise<Reservation | null> {
    const row = await this.database<ReservationRow>('reservations')
      .where({ id: reservationId })
      .first();

    if (row === undefined) {
      return null;
    }

    return toReservation(row, await this.findReservationSeatIds(reservationId));
  }

  async findReservationByReservationRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<Reservation | null> {
    const row = await this.database<ReservationRow>('reservations')
      .where({ reservation_request_id: reservationRequestId })
      .first();

    if (row === undefined) {
      return null;
    }

    return toReservation(row, await this.findReservationSeatIds(row.id));
  }

  private async findReservationRequestSeatIds(
    reservationRequestId: ReservationRequestId,
  ): Promise<readonly SeatId[]> {
    const rows = await this.database<{ readonly seat_id: string }>(
      'reservation_request_seats',
    )
      .select('seat_id')
      .where({ reservation_request_id: reservationRequestId })
      .orderBy('seat_id', 'asc');

    return rows.map((row) => createSeatId(row.seat_id));
  }

  private async requireScreeningRowForProvider(
    database: Knex | Knex.Transaction,
    movieProviderId: MovieProviderId,
    screeningId: ScreeningId,
  ): Promise<ScreeningRow> {
    const row = await database<ScreeningRow>('screenings')
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

  private async findReservationSeatIds(
    reservationId: ReservationId | string,
  ): Promise<readonly SeatId[]> {
    const rows = await this.database<{ readonly seat_id: string }>(
      'reservation_seats',
    )
      .select('seat_id')
      .where({ reservation_id: reservationId })
      .orderBy('seat_id', 'asc');

    return rows.map((row) => createSeatId(row.seat_id));
  }
}
