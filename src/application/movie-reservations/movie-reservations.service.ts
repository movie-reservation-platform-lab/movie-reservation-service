import { randomUUID } from 'node:crypto';

import type { ActorContext } from '../authentication/actor-context';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { Movie } from '../../domain/movie-reservations/movie';
import type { MovieId } from '../../domain/movie-reservations/movie-id';
import {
  createReservationRequest,
  type ReservationRequest,
} from '../../domain/movie-reservations/reservation-request';
import {
  createReservationRequestId,
  type ReservationRequestId,
} from '../../domain/movie-reservations/reservation-request-id';
import type { Reservation } from '../../domain/movie-reservations/reservation';
import type { ReservationId } from '../../domain/movie-reservations/reservation-id';
import type { Screening } from '../../domain/movie-reservations/screening';
import type { ScreeningId } from '../../domain/movie-reservations/screening-id';
import type { Seat } from '../../domain/movie-reservations/seat';
import type { SeatId } from '../../domain/movie-reservations/seat-id';
import type { MovieReservationRepository } from './ports/movie-reservation-repository';

export interface RequestReservationInput {
  readonly screeningId: ScreeningId;
  readonly seatIds: readonly SeatId[];
}

/**
 * Application use cases for movie reservation reads.
 *
 * The service receives `ActorContext` from the presentation/auth edge and uses
 * it to keep provider-scoped data access and authorization decisions out of
 * GraphQL resolvers.
 */
export class MovieReservationsService {
  constructor(
    private readonly repository: MovieReservationRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async listMovies(actor: ActorContext): Promise<readonly Movie[]> {
    return this.repository.findMoviesByProviderId(actor.movieProviderId);
  }

  async getMovie(actor: ActorContext, movieId: MovieId): Promise<Movie | null> {
    return this.repository.findMovieById(actor.movieProviderId, movieId);
  }

  async listScreenings(
    actor: ActorContext,
    input: { readonly movieId?: MovieId } = {},
  ): Promise<readonly Screening[]> {
    const screenings = await this.repository.findScreeningsByProviderId(
      actor.movieProviderId,
    );

    if (input.movieId === undefined) {
      return screenings;
    }

    return screenings.filter(
      (screening) => screening.movieId === input.movieId,
    );
  }

  async listSeatsForScreening(
    actor: ActorContext,
    screeningId: ScreeningId,
  ): Promise<readonly Seat[]> {
    return this.repository.findSeatsByScreeningId(
      actor.movieProviderId,
      screeningId,
    );
  }

  async requestReservation(
    actor: ActorContext,
    input: RequestReservationInput,
  ): Promise<ReservationRequest> {
    const screening = await this.repository.findScreeningForProvider(
      actor.movieProviderId,
      input.screeningId,
    );

    if (screening === null) {
      throw new Error(`Screening ${input.screeningId} was not found`);
    }

    await this.assertSeatsBelongToScreening(actor, input);

    const reservationRequest = createReservationRequest({
      id: createReservationRequestId(`request-${randomUUID()}`),
      movieProviderId: actor.movieProviderId,
      screeningId: input.screeningId,
      seatIds: input.seatIds,
      requestedByUserId: actor.userId,
    });

    await this.repository.saveReservationRequest(reservationRequest);
    return reservationRequest;
  }

  async getReservationRequest(
    actor: ActorContext,
    reservationRequestId: ReservationRequestId,
  ): Promise<ReservationRequest | null> {
    const reservationRequest =
      await this.repository.findReservationRequestById(reservationRequestId);

    if (reservationRequest === null) {
      return null;
    }

    if (
      !this.authorizationService.canReadReservationRequest(
        actor,
        reservationRequest,
      )
    ) {
      return null;
    }

    return reservationRequest;
  }

  async getReservation(
    actor: ActorContext,
    reservationId: ReservationId,
  ): Promise<Reservation | null> {
    const reservation =
      await this.repository.findReservationById(reservationId);

    if (reservation === null) {
      return null;
    }

    if (!this.authorizationService.canReadReservation(actor, reservation)) {
      return null;
    }

    return reservation;
  }

  private async assertSeatsBelongToScreening(
    actor: ActorContext,
    input: RequestReservationInput,
  ): Promise<void> {
    const seats = await this.repository.findSeatsByScreeningId(
      actor.movieProviderId,
      input.screeningId,
    );
    const availableSeatIds = new Set(seats.map((seat) => seat.id));

    for (const seatId of input.seatIds) {
      if (!availableSeatIds.has(seatId)) {
        throw new Error(
          `Seat ${seatId} is not available for screening ${input.screeningId}`,
        );
      }
    }
  }
}
