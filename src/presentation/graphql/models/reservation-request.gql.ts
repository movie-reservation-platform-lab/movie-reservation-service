import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';

registerEnumType(ReservationRequestStatus, {
  name: 'ReservationRequestStatus',
  description:
    'Lifecycle status for an asynchronous reservation request. Clients poll this status after requestReservation.',
  valuesMap: {
    REQUESTED: {
      description:
        'The API accepted the request and it is waiting for processing.',
    },
    PROCESSING: {
      description:
        'The internal processor claimed the request and is working on it.',
    },
    CONFIRMED: {
      description:
        'The request succeeded and produced a confirmed reservation.',
    },
    REJECTED: {
      description:
        'The request was processed but could not be confirmed, usually because a requested seat was already reserved.',
    },
    FAILED: {
      description: 'The request hit an unexpected internal processing failure.',
    },
  },
});

@ObjectType('ReservationRequest', {
  description: 'Intent-driven command to reserve seats.',
})
export class ReservationRequestGql {
  @Field(() => ID, {
    description:
      'Reservation request id returned by requestReservation. Use this id with reservationRequestStatus to poll status and reservationResult to fetch the confirmed result.',
  })
  id!: string;

  @Field(() => ID, {
    description: 'Screening the user asked to reserve seats for.',
  })
  screeningId!: string;

  @Field(() => [ID], {
    description: 'Seat ids included in the reservation request.',
  })
  seatIds!: string[];

  @Field(() => ID, {
    description: 'User id of the authenticated user who created the request.',
  })
  requestedByUserId!: string;

  @Field(() => ReservationRequestStatus, {
    description:
      'Current processing status. Poll this field until it reaches CONFIRMED, REJECTED, or FAILED. Once it is CONFIRMED, call reservationResult with this request id.',
  })
  status!: ReservationRequestStatus;
}
