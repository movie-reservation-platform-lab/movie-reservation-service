import type { ActorContext } from '../../application/authentication/actor-context';
import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';

/**
 * Minimal request shape the GraphQL auth middleware needs to enrich.
 *
 * Nest/Apollo pass a real HTTP request object at runtime; this interface keeps
 * the presentation code typed without coupling the rest of the service to a
 * concrete Express request type.
 */
export interface GraphqlHttpRequest {
  readonly method?: string;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  authenticatedUser?: AuthenticatedUser;
  actor?: ActorContext;
}

/**
 * Authenticated GraphQL context made available to resolvers.
 *
 * `authenticatedUser` exposes the normalized identity for user-facing fields,
 * while `actor` is the smaller business context used by application use cases,
 * logging, tracing, and future tenant routing.
 */
export interface MovieReservationGraphqlContext {
  readonly req: GraphqlHttpRequest;
  readonly authenticatedUser: AuthenticatedUser;
  readonly actor: ActorContext;
}
