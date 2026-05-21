import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('Movie')
export class MovieGql {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  title!: string;

  @Field(() => String)
  rating!: string;

  @Field(() => Int)
  durationMinutes!: number;
}
