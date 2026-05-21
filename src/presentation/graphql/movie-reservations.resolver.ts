import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { MovieReservationsService } from '../../application/movie-reservations/movie-reservations.service';
import { createMovieId } from '../../domain/movie-reservations/movie-id';
import { createReservationId } from '../../domain/movie-reservations/reservation-id';
import { createReservationRequestId } from '../../domain/movie-reservations/reservation-request-id';
import { createScreeningId } from '../../domain/movie-reservations/screening-id';
import { createSeatId } from '../../domain/movie-reservations/seat-id';
import type { MovieReservationGraphqlContext } from './graphql-context';
import { RequestReservationInputGql } from './inputs/request-reservation.input';
import { toAuthenticatedUserGql } from './mappers/authenticated-user.mapper';
import {
  toMovieGql,
  toReservationGql,
  toReservationRequestGql,
  toScreeningGql,
} from './mappers/movie-reservation.mapper';
import { AuthenticatedUserGql } from './models/authenticated-user.gql';
import { MovieGql } from './models/movie.gql';
import { ReservationGql } from './models/reservation.gql';
import { ReservationRequestGql } from './models/reservation-request.gql';
import { ScreeningGql } from './models/screening.gql';

@Resolver()
/**
 * GraphQL resolver for movie reservation operations.
 *
 * Resolvers should stay thin: read GraphQL context/input, call application use
 * cases, and map application/domain output into GraphQL models.
 */
export class MovieReservationsResolver {
  constructor(
    private readonly movieReservationsService: MovieReservationsService,
  ) {}

  @Query(() => AuthenticatedUserGql)
  async me(
    @Context() context: MovieReservationGraphqlContext,
  ): Promise<AuthenticatedUserGql> {
    return toAuthenticatedUserGql(context.authenticatedUser);
  }

  @Query(() => [MovieGql])
  async movies(
    @Context() context: MovieReservationGraphqlContext,
  ): Promise<MovieGql[]> {
    const movies = await this.movieReservationsService.listMovies(
      context.actor,
    );
    return movies.map(toMovieGql);
  }

  @Reflect.metadata('design:paramtypes', [Object, String])
  @Query(() => [ScreeningGql])
  async screenings(
    @Context() context: MovieReservationGraphqlContext,
    @Args('movieId', { type: () => ID, nullable: true })
    movieId?: string,
  ): Promise<ScreeningGql[]> {
    const screeningInput =
      movieId === undefined ? {} : { movieId: createMovieId(movieId) };
    const screenings = await this.movieReservationsService.listScreenings(
      context.actor,
      screeningInput,
    );

    // TODO: Review a DataLoader, batch repository method, or read model before
    // adding the Postgres adapter. Tracked in docs/plans/service-follow-up-tasks.md.
    return Promise.all(
      screenings.map(async (screening) => {
        const seats = await this.movieReservationsService.listSeatsForScreening(
          context.actor,
          screening.id,
        );
        return toScreeningGql(screening, seats);
      }),
    );
  }

  @Reflect.metadata('design:paramtypes', [Object, RequestReservationInputGql])
  @Mutation(() => ReservationRequestGql)
  async requestReservation(
    @Context() context: MovieReservationGraphqlContext,
    @Args('input', { type: () => RequestReservationInputGql })
    input: RequestReservationInputGql,
  ): Promise<ReservationRequestGql> {
    const reservationRequest =
      await this.movieReservationsService.requestReservation(context.actor, {
        screeningId: createScreeningId(input.screeningId),
        seatIds: input.seatIds.map(createSeatId),
      });

    return toReservationRequestGql(reservationRequest);
  }

  @Reflect.metadata('design:paramtypes', [Object, String])
  @Query(() => ReservationRequestGql, { nullable: true })
  async reservationRequestById(
    @Context() context: MovieReservationGraphqlContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ReservationRequestGql | null> {
    const reservationRequest =
      await this.movieReservationsService.getReservationRequest(
        context.actor,
        createReservationRequestId(id),
      );

    return reservationRequest === null
      ? null
      : toReservationRequestGql(reservationRequest);
  }

  @Reflect.metadata('design:paramtypes', [Object, String])
  @Query(() => ReservationGql, { nullable: true })
  async reservation(
    @Context() context: MovieReservationGraphqlContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ReservationGql | null> {
    const reservation = await this.movieReservationsService.getReservation(
      context.actor,
      createReservationId(id),
    );

    return reservation === null ? null : toReservationGql(reservation);
  }
}
