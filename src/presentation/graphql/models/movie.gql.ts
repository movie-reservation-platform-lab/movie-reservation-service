import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('Movie', {
  description: 'Movie title and metadata available within the authenticated movie provider.',
})
export class MovieGql {
  @Field(() => ID, { description: 'Movie id within the movie provider.' })
  id!: string;

  @Field(() => String, {
    description: 'Display title of the movie.',
  })
  title!: string;

  @Field(() => String, {
    description: 'Content rating displayed for the movie.',
  })
  rating!: string;

  @Field(() => Int, {
    description: 'Runtime of the movie in whole minutes.',
  })
  durationMinutes!: number;
}
