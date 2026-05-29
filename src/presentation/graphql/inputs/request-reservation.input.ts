import { Field, ID, InputType } from '@nestjs/graphql';

/**
 * GraphQL input for starting an asynchronous reservation request.
 *
 * `movieProviderId` is intentionally absent. The application derives tenant
 * scope from the authenticated actor context instead of trusting client input.
 */
@InputType('RequestReservationInput', {
  description:
    'Input for creating a reservation request for one screening and one or more seats.',
})
export class RequestReservationInputGql {
  @Field(() => ID, {
    description: 'Screening the user wants to reserve seats for.',
  })
  screeningId!: string;

  @Field(() => [ID], {
    description:
      'Seat ids requested for the screening. The whole request is rejected if any requested seat conflicts during processing.',
  })
  seatIds!: string[];
}
