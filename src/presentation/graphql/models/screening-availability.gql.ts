import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('ScreeningSeatAvailability')
export class ScreeningSeatAvailabilityGql {
  @Field(() => ID)
  seatId!: string;

  @Field(() => Boolean, { description: 'Snapshot only; request processing remains authoritative for conflicts.' })
  available!: boolean;
}

@ObjectType('ScreeningAvailability')
export class ScreeningAvailabilityGql {
  @Field(() => ID)
  screeningId!: string;

  @Field(() => [ScreeningSeatAvailabilityGql])
  seats!: ScreeningSeatAvailabilityGql[];
}
