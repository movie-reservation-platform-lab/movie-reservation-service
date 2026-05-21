import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('Seat')
export class SeatGql {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  row!: string;

  @Field(() => Int)
  number!: number;
}
