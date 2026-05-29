import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('Seat', {
  description: 'Seat position inside an auditorium.',
})
export class SeatGql {
  @Field(() => ID, {
    description: 'Seat id used in RequestReservationInput.seatIds.',
  })
  id!: string;

  @Field(() => String, {
    description: 'Seat row label.',
  })
  row!: string;

  @Field(() => Int, {
    description: 'Seat number within the row.',
  })
  number!: number;
}
