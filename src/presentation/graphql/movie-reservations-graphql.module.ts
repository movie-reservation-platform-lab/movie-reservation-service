import { type DynamicModule, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import {
  MovieReservationsCompositionModule,
  type MovieReservationsCompositionOptions,
} from '../../di/movie-reservations/movie-reservations-composition.module';
import { GraphqlAuthenticationMiddleware } from './middleware/graphql-authentication.middleware';
import { MovieReservationsResolver } from './movie-reservations.resolver';

/**
 * Presentation module for the movie reservation GraphQL API.
 *
 * It wires the GraphQL resolver and request middleware to the movie reservation
 * composition module, keeping NestJS framework concerns at the outer edge.
 */
@Module({})
export class MovieReservationsGraphqlModule implements NestModule {
  static forRoot(options: MovieReservationsCompositionOptions): DynamicModule {
    return {
      module: MovieReservationsGraphqlModule,
      imports: [MovieReservationsCompositionModule.forRoot(options)],
      providers: [GraphqlAuthenticationMiddleware, MovieReservationsResolver],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GraphqlAuthenticationMiddleware).forRoutes('graphql');
  }
}
