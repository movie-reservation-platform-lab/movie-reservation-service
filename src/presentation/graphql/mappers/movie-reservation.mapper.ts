import type { Movie } from '../../../domain/movie-reservations/movie';
import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { Screening } from '../../../domain/movie-reservations/screening';
import type { Seat } from '../../../domain/movie-reservations/seat';
import { MovieGql } from '../models/movie.gql';
import { ReservationGql } from '../models/reservation.gql';
import { ReservationRequestGql } from '../models/reservation-request.gql';
import { ScreeningGql } from '../models/screening.gql';
import { SeatGql } from '../models/seat.gql';

/**
 * TODO: split the mappers into smaller files
 */

export function toMovieGql(movie: Movie): MovieGql {
  const gql = new MovieGql();
  gql.id = movie.id;
  gql.title = movie.title;
  gql.rating = movie.rating;
  gql.durationMinutes = movie.durationMinutes;
  return gql;
}

export function toScreeningGql(screening: Screening, seats: readonly Seat[]): ScreeningGql {
  const gql = new ScreeningGql();
  gql.id = screening.id;
  gql.movieId = screening.movieId;
  gql.auditoriumId = screening.auditoriumId;
  gql.startsAt = screening.startsAt;
  gql.endsAt = screening.endsAt;
  gql.seats = seats.map(toSeatGql);
  return gql;
}

export function toSeatGql(seat: Seat): SeatGql {
  const gql = new SeatGql();
  gql.id = seat.id;
  gql.row = seat.row;
  gql.number = seat.number;
  return gql;
}

export function toReservationRequestGql(reservationRequest: ReservationRequest): ReservationRequestGql {
  const gql = new ReservationRequestGql();
  gql.id = reservationRequest.id;
  gql.screeningId = reservationRequest.screeningId;
  gql.seatIds = [...reservationRequest.seatIds];
  gql.requestedByUserId = reservationRequest.requestedByUserId;
  gql.status = reservationRequest.status;
  return gql;
}

export function toReservationGql(reservation: Reservation): ReservationGql {
  const gql = new ReservationGql();
  gql.id = reservation.id;
  gql.reservationRequestId = reservation.reservationRequestId;
  gql.screeningId = reservation.screeningId;
  gql.seatIds = [...reservation.seatIds];
  gql.reservedByUserId = reservation.reservedByUserId;
  gql.confirmedAt = reservation.confirmedAt;
  return gql;
}
