import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { type DynamicModule, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { generatedGraphqlSchemaPath } from './generated-graphql-schema';
import type { ActorContext } from './application/authentication/actor-context';
import type { AuthenticatedUser } from './domain/authentication/authenticated-user';
import { config } from './config';
import { createAppComposition, type AppCompositionOverrides } from './di/app-composition';
import type { GraphqlHttpRequest, MovieReservationGraphqlContext } from './presentation/graphql/graphql-context';
import { MovieReservationsGraphqlModule } from './presentation/graphql/movie-reservations-graphql.module';
import type { GraphqlOperationLogger } from './presentation/graphql/plugins/graphql-operation-logging.plugin';
import { createGraphqlOperationLoggingPlugin } from './presentation/graphql/plugins/graphql-operation-logging.plugin';
import { HealthModule } from './presentation/http/health.module';

export interface AppModuleOptions extends AppCompositionOverrides {
  readonly graphqlOperationLogger?: GraphqlOperationLogger;
}

@Module({})
/**
 * Root NestJS application module.
 *
 * It configures framework-level concerns such as Apollo GraphQL, health
 * endpoints, and feature modules while leaving business behavior inside the
 * application/domain layers.
 */
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    const appComposition = createAppComposition(options);

    const gqlContext = ({ req }: { req: GraphqlHttpRequest }): MovieReservationGraphqlContext => ({
      req,
      authenticatedUser: requireAuthenticatedUser(req),
      actor: requireActor(req),
    });
    const gqlModuleOptions = {
      driver: ApolloDriver,
      autoSchemaFile: generatedGraphqlSchemaPath,
      sortSchema: true,
      context: gqlContext,
      plugins: [createGraphqlOperationLoggingPlugin(options.graphqlOperationLogger)],
      graphiql: config.ENABLE_GRAPHIQL,
      playground: false,
    } satisfies ApolloDriverConfig;

    return {
      module: AppModule,
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>(gqlModuleOptions),
        HealthModule,
        MovieReservationsGraphqlModule.forRoot(appComposition.movieReservations),
      ],
    };
  }
}

function requireAuthenticatedUser(req: GraphqlHttpRequest): AuthenticatedUser {
  if (req.authenticatedUser === undefined) {
    throw new Error('GraphQL authenticated user context was not initialized');
  }

  return req.authenticatedUser;
}

function requireActor(req: GraphqlHttpRequest): ActorContext {
  if (req.actor === undefined) {
    throw new Error('GraphQL actor context was not initialized');
  }

  return req.actor;
}
