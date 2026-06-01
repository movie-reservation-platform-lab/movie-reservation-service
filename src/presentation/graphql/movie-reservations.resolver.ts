import { Inject } from '@nestjs/common';
import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { MovieReservationsService } from '../../application/movie-reservations/movie-reservations.service';
import { createMovieId } from '../../domain/movie-reservations/movie-id';
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

/**
 * GraphQL resolver for movie reservation operations.
 *
 * Resolvers should stay thin: read GraphQL context/input, call application use
 * cases, and map application/domain output into GraphQL models.
 */
@Resolver()
export class MovieReservationsResolver {
  constructor(
    @Inject(MovieReservationsService)
    private readonly movieReservationsService: MovieReservationsService,
  ) {}

  @Query(() => AuthenticatedUserGql, {
    description:
      'Returns the authenticated user and movie provider context for this request.',
  })
  async me(
    @Context() context: MovieReservationGraphqlContext,
  ): Promise<AuthenticatedUserGql> {
    return toAuthenticatedUserGql(context.authenticatedUser);
  }

  @Query(() => [MovieGql], {
    description:
      'Lists movies available to the authenticated user within their movie provider.',
  })
  async movies(
    @Context() context: MovieReservationGraphqlContext,
  ): Promise<MovieGql[]> {
    const movies = await this.movieReservationsService.listMovies(
      context.actor,
    );
    return movies.map(toMovieGql);
  }

  /**
   * List scheduled screenings, optionally filtered to one movie
   *
   * @param context
   * @param movieId
   *
   * TODO: Move this read-model assembly into an application query/use-case
   *  method, such as `listScreeningsWithSeats`. Resolvers should not know
   *  how to join screenings with nested seat data. Tracked in
   *  docs/plans/service-follow-up-tasks.md.
   */
  @Reflect.metadata('design:paramtypes', [Object, String])
  @Query(() => [ScreeningGql], {
    description:
      'Lists scheduled screenings, optionally filtered to one movie. The nested seats are the auditorium seats for the screening, not a dedicated availability calculation.',
  })
  async screenings(
    @Context() context: MovieReservationGraphqlContext,
    @Args('movieId', {
      type: () => ID,
      nullable: true,
      description: 'Optional movie id used to show screenings for one movie.',
    })
    movieId?: string,
  ): Promise<ScreeningGql[]> {
    const screeningInput =
      movieId === undefined ? {} : { movieId: createMovieId(movieId) };
    const screenings = await this.movieReservationsService.listScreenings(
      context.actor,
      screeningInput,
    );

    const seatsByScreeningId =
      await this.movieReservationsService.listSeatsForScreenings(
        context.actor,
        screenings.map((screening) => screening.id),
      );

    return screenings.map((screening) =>
      toScreeningGql(screening, seatsByScreeningId.get(screening.id) ?? []),
    );
  }

  @Reflect.metadata('design:paramtypes', [Object, RequestReservationInputGql])
  @Mutation(() => ReservationRequestGql, {
    description:
      'Creates an asynchronous reservation request and returns its initial status. Processing happens later through the internal reservation request processor.',
  })
  async requestReservation(
    @Context() context: MovieReservationGraphqlContext,
    @Args('input', {
      type: () => RequestReservationInputGql,
      description:
        'Screening and seat ids for the reservation request. Tenant scope comes from authentication, not from this input.',
    })
    input: RequestReservationInputGql,
  ): Promise<ReservationRequestGql> {
    const reservationRequest =
      await this.movieReservationsService.requestReservation(context.actor, {
        screeningId: createScreeningId(input.screeningId),
        seatIds: input.seatIds.map(createSeatId),
      });

    return toReservationRequestGql(reservationRequest);
  }

  // TODO: Replace these nullable read contracts with explicit GraphQL
  //  payloads/unions before treating the API as production-shaped. Today `null`
  //  can mean not found, unauthorized/hidden, not confirmed yet, rejected,
  //  failed, or inconsistent data.
  @Reflect.metadata('design:paramtypes', [Object, String])
  @Query(() => ReservationRequestGql, {
    nullable: true,
    description:
      'Polls the status of a reservation request created by requestReservation.',
  })
  async reservationRequestStatus(
    @Context() context: MovieReservationGraphqlContext,
    @Args('id', {
      type: () => ID,
      description: 'Reservation request id returned by requestReservation.',
    })
    id: string,
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
  @Query(() => ReservationGql, {
    nullable: true,
    description:
      'Fetches the confirmed reservation produced by a completed reservation request.',
  })
  async reservationResult(
    @Context() context: MovieReservationGraphqlContext,
    @Args('requestId', {
      type: () => ID,
      description:
        'Reservation request id returned by requestReservation. Returns null until the request is confirmed.',
    })
    requestId: string,
  ): Promise<ReservationGql | null> {
    const reservation =
      await this.movieReservationsService.getReservationByReservationRequestId(
        context.actor,
        createReservationRequestId(requestId),
      );

    return reservation === null ? null : toReservationGql(reservation);
  }
}
