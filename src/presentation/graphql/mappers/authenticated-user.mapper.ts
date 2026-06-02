import type { AuthenticatedUser } from '../../../domain/authentication/authenticated-user';
import { AuthenticatedUserGql } from '../models/authenticated-user.gql';

/**
 * Converts the normalized domain/application identity into a GraphQL model.
 *
 * The mapper keeps GraphQL classes out of the domain and application layers.
 */
export function toAuthenticatedUserGql(authenticatedUser: AuthenticatedUser): AuthenticatedUserGql {
  const gql = new AuthenticatedUserGql();
  gql.userId = authenticatedUser.userId;
  gql.username = authenticatedUser.username;
  gql.email = authenticatedUser.email;
  gql.movieProviderId = authenticatedUser.movieProviderId;
  if (authenticatedUser.movieProviderCode !== undefined) {
    gql.movieProviderCode = authenticatedUser.movieProviderCode;
  }
  gql.roles = [...authenticatedUser.roles];
  gql.scopes = [...authenticatedUser.scopes];
  return gql;
}
