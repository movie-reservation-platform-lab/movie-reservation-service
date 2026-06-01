import type { ActorContext } from '../authentication/actor-context';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { Movie } from '../../domain/movie-reservations/movie';
import type { MovieId } from '../../domain/movie-reservations/movie-id';
import {
  createReservationRequest,
  type ReservationRequest,
} from '../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../domain/movie-reservations/reservation-request-id';
import type { Reservation } from '../../domain/movie-reservations/reservation';
import type { ReservationId } from '../../domain/movie-reservations/reservation-id';
import type { Screening } from '../../domain/movie-reservations/screening';
import type { ScreeningId } from '../../domain/movie-reservations/screening-id';
import type { Seat } from '../../domain/movie-reservations/seat';
import type { SeatId } from '../../domain/movie-reservations/seat-id';
import type { MovieReservationRepository } from './ports/movie-reservation-repository';
import type { ReservationRequestIdGenerator } from './ports/reservation-request-id-generator';

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
    private readonly reservationRequestIdGenerator: ReservationRequestIdGenerator,
  ) {}

  /**
   * List movies belonging to the movie provider (tenant)
   */
  async listMovies(actor: ActorContext): Promise<readonly Movie[]> {
    return this.repository.findMoviesByProviderId(actor.movieProviderId);
  }

  /**
   * Retrieve a single movie (only if it belongs to the authenticated user's provider)
   *
   * TODO: unauthenticated access results in null - change the behavior and error handling
   *
   */
  async getMovie(actor: ActorContext, movieId: MovieId): Promise<Movie | null> {
    return this.repository.findMovieById(actor.movieProviderId, movieId);
  }

  /**
   * List provider-scoped screenings, optionally narrowed to one movie.
   */
  async listScreenings(
    actor: ActorContext,
    input: { readonly movieId?: MovieId } = {},
  ): Promise<readonly Screening[]> {
    return this.repository.findScreeningsByProviderId(
      actor.movieProviderId,
      input,
    );
  }

  /**
   * List auditorium seats for a provider-owned screening.
   */
  async listSeatsForScreening(
    actor: ActorContext,
    screeningId: ScreeningId,
  ): Promise<readonly Seat[]> {
    return this.repository.findSeatsByScreeningId(
      actor.movieProviderId,
      screeningId,
    );
  }

  /**
   * Batch-load auditorium seats for multiple provider-owned screenings.
   */
  async listSeatsForScreenings(
    actor: ActorContext,
    screeningIds: readonly ScreeningId[],
  ): Promise<ReadonlyMap<ScreeningId, readonly Seat[]>> {
    return this.repository.findSeatsByScreeningIds(
      actor.movieProviderId,
      screeningIds,
    );
  }

  /**
   * Create a REQUESTED reservation request and returns before processing.
   */
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
      id: this.reservationRequestIdGenerator.generateReservationRequestId(),
      movieProviderId: actor.movieProviderId,
      screeningId: input.screeningId,
      seatIds: input.seatIds,
      requestedByUserId: actor.userId,
    });

    await this.repository.saveReservationRequest(reservationRequest);
    return reservationRequest;
  }

  /**
   * Read a reservation request when the actor is allowed to see its status.
   *
   * Returns null for both missing and unauthorized/hidden requests. This is a
   * short-term GraphQL contract; explicit typed read results are tracked as a
   * follow-up before production-shaped APIs.
   */
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

  /**
   * Read a confirmed reservation by id when the actor is authorized.
   */
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

  /**
   * Read the confirmed reservation produced by a request when visible.
   *
   * Returns null when the request is not confirmed yet, no reservation exists,
   * or the actor is not allowed to see the result.
   */
  async getReservationByReservationRequestId(
    actor: ActorContext,
    reservationRequestId: ReservationRequestId,
  ): Promise<Reservation | null> {
    const reservation =
      await this.repository.findReservationByReservationRequestId(
        reservationRequestId,
      );

    if (reservation === null) {
      return null;
    }

    if (!this.authorizationService.canReadReservation(actor, reservation)) {
      return null;
    }

    return reservation;
  }

  /**
   * Ensure requested seats belong to the target screening's auditorium.
   *
   * @throws {Error} when the seat doesn't belong to the given screening
   */
  private async assertSeatsBelongToScreening(
    actor: ActorContext,
    input: RequestReservationInput,
  ): Promise<void> {
    const seats = await this.repository.findSeatsByIdsForScreening(
      actor.movieProviderId,
      input.screeningId,
      input.seatIds,
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
