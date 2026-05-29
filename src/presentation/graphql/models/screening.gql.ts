import { Field, ID, ObjectType } from '@nestjs/graphql';

import { SeatGql } from './seat.gql';

@ObjectType('Screening', {
  description:
    'Scheduled showing of a movie in an auditorium during a specific time window.',
})
export class ScreeningGql {
  @Field(() => ID, {
    description: 'Screening id used when requesting a reservation.',
  })
  id!: string;

  @Field(() => ID, {
    description: 'Movie shown during this screening.',
  })
  movieId!: string;

  @Field(() => ID, {
    description: 'Auditorium where this screening takes place.',
  })
  auditoriumId!: string;

  @Field(() => String, {
    description: 'ISO 8601 UTC timestamp when the screening starts.',
  })
  startsAt!: string;

  @Field(() => String, {
    description: 'ISO 8601 UTC timestamp when the screening ends.',
  })
  endsAt!: string;

  @Field(() => [SeatGql], {
    description:
      'Auditorium seats for this screening. This is not yet a dedicated availability calculation.',
  })
  seats!: SeatGql[];
}
