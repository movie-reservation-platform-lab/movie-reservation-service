import { Context, Query, Resolver } from '@nestjs/graphql';

import type { MovieReservationGraphqlContext } from './graphql-context';
import { toAuthenticatedUserGql } from './mappers/authenticated-user.mapper';
import { AuthenticatedUserGql } from './models/authenticated-user.gql';

@Resolver(() => AuthenticatedUserGql)
/**
 * GraphQL resolver for movie reservation operations.
 *
 * Resolvers should stay thin: read GraphQL context/input, call application use
 * cases, and map application/domain output into GraphQL models.
 */
export class MovieReservationsResolver {
  @Query(() => AuthenticatedUserGql)
  async me(
    @Context() context: MovieReservationGraphqlContext,
  ): Promise<AuthenticatedUserGql> {
    return toAuthenticatedUserGql(context.authenticatedUser);
  }
}
