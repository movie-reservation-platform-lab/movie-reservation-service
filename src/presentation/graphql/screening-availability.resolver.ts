import { Inject } from '@nestjs/common';
import { Args, Context, ID, Query, Resolver } from '@nestjs/graphql';
import { ScreeningAvailabilityService } from '../../application/movie-reservations/screening-availability.service';
import { createScreeningId } from '../../domain/movie-reservations/screening-id';
import type { MovieReservationGraphqlContext } from './graphql-context';
import { ScreeningAvailabilityGql } from './models/screening-availability.gql';

@Resolver()
export class ScreeningAvailabilityResolver {
  constructor(@Inject(ScreeningAvailabilityService) private readonly service: ScreeningAvailabilityService) {}

  @Reflect.metadata('design:paramtypes', [Object, String])
  @Query(() => ScreeningAvailabilityGql, {
    nullable: true,
    description:
      'Confirmed occupancy for one provider-owned screening. Null means missing or inaccessible. Pending requests are not holds.',
  })
  async screeningAvailability(
    @Context() context: MovieReservationGraphqlContext,
    @Args('screeningId', { type: () => ID }) screeningId: string,
  ): Promise<ScreeningAvailabilityGql | null> {
    const result = await this.service.read(context.actor, createScreeningId(screeningId));
    return result === null
      ? null
      : {
          screeningId: result.screeningId,
          seats: result.seats.map((seat) => ({ ...seat })),
        };
  }
}
