import type { ActorContext } from '../authentication/actor-context';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { Movie } from '../../domain/movie-reservations/movie';
import type { MovieId } from '../../domain/movie-reservations/movie-id';
import type { Reservation } from '../../domain/movie-reservations/reservation';
import type { ReservationId } from '../../domain/movie-reservations/reservation-id';
import type { MovieReservationRepository } from './ports/movie-reservation-repository';

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
}
