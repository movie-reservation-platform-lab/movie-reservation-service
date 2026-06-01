import type { ReservationRequestProcessingAttempt } from '../../../application/movie-reservations/reservation-request-processing-attempt';
import { ReservationRequestAlreadyExistsError } from '../../../application/movie-reservations/errors/reservation-request-already-exists-error';
import type { Auditorium } from '../../../domain/movie-reservations/auditorium';
import type { AuditoriumId } from '../../../domain/movie-reservations/auditorium-id';
import type { Movie } from '../../../domain/movie-reservations/movie';
import type { MovieId } from '../../../domain/movie-reservations/movie-id';
import type { MovieProvider } from '../../../domain/movie-reservations/movie-provider';
import type { MovieProviderId } from '../../../domain/movie-reservations/movie-provider-id';
import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationId } from '../../../domain/movie-reservations/reservation-id';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import {
  createReservationRequestSequence,
  type ReservationRequestSequence,
} from '../../../domain/movie-reservations/reservation-request-sequence';
import type { Screening } from '../../../domain/movie-reservations/screening';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { Seat } from '../../../domain/movie-reservations/seat';
import type { SeatId } from '../../../domain/movie-reservations/seat-id';
import { createInMemoryMovieReservationSeedData } from './in-memory-movie-reservation-seed-data';

export interface InMemoryMovieReservationStoreInput {
  readonly movieProviders: readonly MovieProvider[];
  readonly auditoriums: readonly Auditorium[];
  readonly movies: readonly Movie[];
  readonly screenings: readonly Screening[];
  readonly seats: readonly Seat[];
  readonly reservationRequests: readonly ReservationRequest[];
  readonly reservations: readonly Reservation[];
  readonly processingAttempts?: readonly ReservationRequestProcessingAttempt[];
}

export interface InMemoryReservationRequestWorkMetadata {
  readonly sequence: ReservationRequestSequence;
  readonly leaseTimeoutCount: number;
  readonly transientFailureCount: number;
  readonly claimedBy?: string;
  readonly claimToken?: string;
  readonly claimedAt?: string;
  readonly claimExpiresAt?: string;
  readonly lastHeartbeatAt?: string;
}

/**
 * Fake database shared by the read/write repository adapters.
 *
 * This mirrors a future database connection: multiple repositories can speak
 * about the same data without merging their application-facing responsibilities.
 * That shape is common when one actor writes control-plane state and another
 * actor reads or processes data-plane work.
 *
 * The maps are intentionally exposed to keep this fake storage small and easy
 * to inspect in tests. Durable persistence should not copy this shortcut:
 * transaction boundaries, locking, uniqueness, and mutation rules belong behind
 * repository methods or database constraints.
 */
export class InMemoryMovieReservationStore {
  readonly movieProvidersById = new Map<MovieProviderId, MovieProvider>();
  readonly auditoriumsById = new Map<AuditoriumId, Auditorium>();
  readonly moviesById = new Map<MovieId, Movie>();
  readonly screeningsById = new Map<ScreeningId, Screening>();
  readonly seatsById = new Map<SeatId, Seat>();
  readonly reservationRequestsById = new Map<
    ReservationRequestId,
    ReservationRequest
  >();
  readonly reservationsById = new Map<ReservationId, Reservation>();
  readonly processingAttemptsByReservationRequestId = new Map<
    ReservationRequestId,
    ReservationRequestProcessingAttempt[]
  >();
  readonly reservationRequestWorkMetadataById = new Map<
    ReservationRequestId,
    InMemoryReservationRequestWorkMetadata
  >();

  private nextReservationRequestSequenceValue = 1;

  constructor(input: InMemoryMovieReservationStoreInput) {
    for (const movieProvider of input.movieProviders) {
      this.movieProvidersById.set(movieProvider.id, movieProvider);
    }

    for (const auditorium of input.auditoriums) {
      this.auditoriumsById.set(auditorium.id, auditorium);
    }

    for (const movie of input.movies) {
      this.moviesById.set(movie.id, movie);
    }

    for (const screening of input.screenings) {
      this.screeningsById.set(screening.id, screening);
    }

    for (const seat of input.seats) {
      this.seatsById.set(seat.id, seat);
    }

    for (const reservationRequest of input.reservationRequests) {
      this.saveReservationRequest(reservationRequest);
    }

    for (const reservation of input.reservations) {
      this.reservationsById.set(reservation.id, reservation);
    }

    for (const attempt of input.processingAttempts ?? []) {
      this.recordProcessingAttempt(attempt);
    }
  }

  static withSeedData(): InMemoryMovieReservationStore {
    return new InMemoryMovieReservationStore(
      createInMemoryMovieReservationSeedData(),
    );
  }

  saveReservationRequest(reservationRequest: ReservationRequest): void {
    if (this.reservationRequestsById.has(reservationRequest.id)) {
      throw new ReservationRequestAlreadyExistsError(reservationRequest.id);
    }

    this.reservationRequestsById.set(reservationRequest.id, reservationRequest);
    this.reservationRequestWorkMetadataById.set(reservationRequest.id, {
      sequence: this.allocateReservationRequestSequence(),
      leaseTimeoutCount: 0,
      transientFailureCount: 0,
    });
  }

  getReservationRequestSequence(
    reservationRequestId: ReservationRequestId,
  ): ReservationRequestSequence {
    return this.getReservationRequestWorkMetadata(reservationRequestId)
      .sequence;
  }

  getReservationRequestWorkMetadata(
    reservationRequestId: ReservationRequestId,
  ): InMemoryReservationRequestWorkMetadata {
    const metadata =
      this.reservationRequestWorkMetadataById.get(reservationRequestId);

    if (metadata === undefined) {
      throw new Error(
        `Reservation request ${reservationRequestId} does not have work metadata`,
      );
    }

    return metadata;
  }

  updateReservationRequestWorkMetadata(
    reservationRequestId: ReservationRequestId,
    metadata: InMemoryReservationRequestWorkMetadata,
  ): void {
    this.reservationRequestWorkMetadataById.set(reservationRequestId, metadata);
  }

  recordProcessingAttempt(attempt: ReservationRequestProcessingAttempt): void {
    const attempts =
      this.processingAttemptsByReservationRequestId.get(
        attempt.reservationRequestId,
      ) ?? [];

    this.processingAttemptsByReservationRequestId.set(
      attempt.reservationRequestId,
      [...attempts, attempt],
    );
  }

  private allocateReservationRequestSequence(): ReservationRequestSequence {
    const sequence = createReservationRequestSequence(
      this.nextReservationRequestSequenceValue,
    );
    this.nextReservationRequestSequenceValue += 1;

    return sequence;
  }
}
