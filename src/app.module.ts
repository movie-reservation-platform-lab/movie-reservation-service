import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { type DynamicModule, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { generatedGraphqlSchemaPath } from './generated-graphql-schema';
import type { ActorContext } from './application/authentication/actor-context';
import { config, type AuthMode } from './config';
import type {
  GraphqlHttpRequest,
  MovieReservationGraphqlContext,
} from './presentation/graphql/graphql-context';
import { MovieReservationsGraphqlModule } from './presentation/graphql/movie-reservations-graphql.module';
import { HealthModule } from './presentation/http/health.module';

export interface AppModuleOptions {
  readonly authMode?: AuthMode;
}

@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    const authMode = options.authMode ?? config.AUTH_MODE;

    const gqlContext = ({
      req,
    }: {
      req: GraphqlHttpRequest;
    }): MovieReservationGraphqlContext => ({ req, actor: requireActor(req) });
    const gqlModuleOptions = {
      driver: ApolloDriver,
      autoSchemaFile: generatedGraphqlSchemaPath,
      sortSchema: true,
      context: gqlContext,
    } satisfies ApolloDriverConfig;

    return {
      module: AppModule,
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>(gqlModuleOptions),
        HealthModule,
        MovieReservationsGraphqlModule.forRoot({ authMode }),
      ],
    };
  }
}

function requireActor(req: GraphqlHttpRequest): ActorContext {
  if (req.actor === undefined) {
    throw new Error('GraphQL actor context was not initialized');
  }

  return req.actor;
}
