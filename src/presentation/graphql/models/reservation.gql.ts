import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('Reservation')
export class ReservationGql {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  reservationRequestId!: string;

  @Field(() => ID)
  screeningId!: string;

  @Field(() => [ID])
  seatIds!: string[];

  @Field(() => ID)
  reservedByUserId!: string;

  @Field(() => String)
  confirmedAt!: string;
}
