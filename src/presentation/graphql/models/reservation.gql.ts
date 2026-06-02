import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('Reservation', {
  description: 'Final confirmed booking created after a reservation request is successfully processed.',
})
export class ReservationGql {
  @Field(() => ID, {
    description: 'Confirmed reservation id. Clients usually reach this object through reservationResult(requestId).',
  })
  id!: string;

  @Field(() => ID, {
    description: 'Reservation request that produced this confirmed reservation.',
  })
  reservationRequestId!: string;

  @Field(() => ID, {
    description: 'Screening reserved by this confirmed reservation.',
  })
  screeningId!: string;

  @Field(() => [ID], {
    description: 'Seat ids reserved for the screening.',
  })
  seatIds!: string[];

  @Field(() => ID, {
    description: 'User id of the customer who owns the confirmed reservation.',
  })
  reservedByUserId!: string;

  @Field(() => String, {
    description: 'ISO 8601 UTC timestamp when the reservation was confirmed.',
  })
  confirmedAt!: string;
}
