import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';

registerEnumType(ReservationRequestStatus, {
  name: 'ReservationRequestStatus',
});

@ObjectType('ReservationRequest')
export class ReservationRequestGql {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  screeningId!: string;

  @Field(() => [ID])
  seatIds!: string[];

  @Field(() => ID)
  requestedByUserId!: string;

  @Field(() => ReservationRequestStatus)
  status!: ReservationRequestStatus;
}
