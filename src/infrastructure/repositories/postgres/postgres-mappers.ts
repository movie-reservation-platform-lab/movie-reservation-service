import { createUserId } from '../../../domain/authentication/user-id';
import type { Auditorium } from '../../../domain/movie-reservations/auditorium';
import { createAuditoriumId } from '../../../domain/movie-reservations/auditorium-id';
import type { Movie } from '../../../domain/movie-reservations/movie';
import { createMovieId } from '../../../domain/movie-reservations/movie-id';
import type { MovieProvider } from '../../../domain/movie-reservations/movie-provider';
import { createMovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import { createReservation, type Reservation } from '../../../domain/movie-reservations/reservation';
import { createReservationId } from '../../../domain/movie-reservations/reservation-id';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import {
  createReservationRequestSequence,
  type ReservationRequestSequence,
} from '../../../domain/movie-reservations/reservation-request-sequence';
import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';
import type { Screening } from '../../../domain/movie-reservations/screening';
import { createScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { Seat } from '../../../domain/movie-reservations/seat';
import { createSeatId, type SeatId } from '../../../domain/movie-reservations/seat-id';
import type { ReservationRequestProcessingAttempt } from '../../../application/movie-reservations/reservation-request-processing-attempt';

export interface MovieProviderRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface MovieRow {
  readonly id: string;
  readonly movie_provider_id: string;
  readonly title: string;
  readonly rating: string;
  readonly duration_minutes: number;
}

export interface AuditoriumRow {
  readonly id: string;
  readonly movie_provider_id: string;
  readonly name: string;
}

export interface ScreeningRow {
  readonly id: string;
  readonly movie_provider_id: string;
  readonly movie_id: string;
  readonly auditorium_id: string;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
}

export interface SeatRow {
  readonly id: string;
  readonly movie_provider_id: string;
  readonly auditorium_id: string;
  readonly row_label: string;
  readonly seat_number: number;
}

export interface ReservationRequestRow {
  readonly id: string;
  readonly sequence: number | string;
  readonly movie_provider_id: string;
  readonly screening_id: string;
  readonly requested_by_user_id: string;
  readonly status: string;
  readonly requested_at?: Date | string;
  readonly claimed_by?: string | null;
  readonly claim_token?: string | null;
  readonly claimed_at?: Date | string | null;
  readonly claim_expires_at?: Date | string | null;
  readonly last_heartbeat_at?: Date | string | null;
  readonly lease_timeout_count: number | string;
  readonly transient_failure_count: number | string;
  readonly processed_at?: Date | string | null;
  readonly updated_at?: Date | string;
}

export interface ReservationRow {
  readonly id: string;
  readonly movie_provider_id: string;
  readonly reservation_request_id: string;
  readonly screening_id: string;
  readonly reserved_by_user_id: string;
  readonly confirmed_at: Date | string;
}

export interface ReservationRequestProcessingAttemptRow {
  readonly reservation_request_id: string;
  readonly reservation_request_sequence: number | string;
  readonly started_at: Date | string;
  readonly completed_at: Date | string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly reservation_id: string | null;
  readonly conflicting_reservation_id: string | null;
}

export function toMovieProvider(row: MovieProviderRow): MovieProvider {
  return {
    id: createMovieProviderId(row.id),
    code: row.code,
    name: row.name,
  };
}

export function toMovie(row: MovieRow): Movie {
  return {
    id: createMovieId(row.id),
    movieProviderId: createMovieProviderId(row.movie_provider_id),
    title: row.title,
    rating: row.rating,
    durationMinutes: row.duration_minutes,
  };
}

export function toAuditorium(row: AuditoriumRow): Auditorium {
  return {
    id: createAuditoriumId(row.id),
    movieProviderId: createMovieProviderId(row.movie_provider_id),
    name: row.name,
  };
}

export function toScreening(row: ScreeningRow): Screening {
  return {
    id: createScreeningId(row.id),
    movieProviderId: createMovieProviderId(row.movie_provider_id),
    movieId: createMovieId(row.movie_id),
    auditoriumId: createAuditoriumId(row.auditorium_id),
    startsAt: toIsoString(row.starts_at),
    endsAt: toIsoString(row.ends_at),
  };
}

export function toSeat(row: SeatRow): Seat {
  return {
    id: createSeatId(row.id),
    movieProviderId: createMovieProviderId(row.movie_provider_id),
    auditoriumId: createAuditoriumId(row.auditorium_id),
    row: row.row_label,
    number: row.seat_number,
  };
}

export function toReservationRequest(row: ReservationRequestRow, seatIds: readonly SeatId[]): ReservationRequest {
  return {
    id: createReservationRequestId(row.id),
    movieProviderId: createMovieProviderId(row.movie_provider_id),
    screeningId: createScreeningId(row.screening_id),
    seatIds: [...seatIds],
    requestedByUserId: createUserId(row.requested_by_user_id),
    status: parseReservationRequestStatus(row.status),
  };
}

export function toReservation(row: ReservationRow, seatIds: readonly SeatId[]): Reservation {
  return createReservation({
    id: createReservationId(row.id),
    movieProviderId: createMovieProviderId(row.movie_provider_id),
    reservationRequestId: createReservationRequestId(row.reservation_request_id),
    screeningId: createScreeningId(row.screening_id),
    seatIds,
    reservedByUserId: createUserId(row.reserved_by_user_id),
    confirmedAt: toIsoString(row.confirmed_at),
  });
}

export function toReservationRequestSequence(value: number | string): ReservationRequestSequence {
  return createReservationRequestSequence(Number(value));
}

export function toReservationRequestProcessingAttempt(
  row: ReservationRequestProcessingAttemptRow,
): ReservationRequestProcessingAttempt {
  const base = {
    reservationRequestId: createReservationRequestId(row.reservation_request_id),
    sequence: toReservationRequestSequence(row.reservation_request_sequence),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
  };

  if (row.outcome === 'confirmed' && row.reservation_id !== null) {
    return {
      ...base,
      outcome: 'confirmed',
      reservationId: createReservationId(row.reservation_id),
    };
  }

  if (row.outcome === 'rejected' && row.reason === 'seat-conflict' && row.conflicting_reservation_id !== null) {
    return {
      ...base,
      outcome: 'rejected',
      reason: 'seat-conflict',
      conflictingReservationId: createReservationId(row.conflicting_reservation_id),
    };
  }

  if (row.outcome === 'failed' && (row.reason === 'unexpected-error' || row.reason === 'lease-timeout')) {
    return {
      ...base,
      outcome: 'failed',
      reason: row.reason,
    };
  }

  throw new Error(`Invalid reservation request processing attempt row for ${row.reservation_request_id}`);
}

export function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function parseReservationRequestStatus(value: string): ReservationRequestStatus {
  if (Object.values(ReservationRequestStatus).includes(value as ReservationRequestStatus)) {
    return value as ReservationRequestStatus;
  }

  throw new Error(`Invalid reservation request status from database: ${value}`);
}
