import { Field, ID, ObjectType } from '@nestjs/graphql';

import { SeatGql } from './seat.gql';

@ObjectType('Screening')
export class ScreeningGql {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  movieId!: string;

  @Field(() => ID)
  auditoriumId!: string;

  @Field(() => String)
  startsAt!: string;

  @Field(() => String)
  endsAt!: string;

  @Field(() => [SeatGql])
  seats!: SeatGql[];
}
