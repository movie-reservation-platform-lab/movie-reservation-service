import { Field, ID, InputType } from '@nestjs/graphql';

@InputType('RequestReservationInput')
/**
 * GraphQL input for starting an asynchronous reservation request.
 *
 * `movieProviderId` is intentionally absent. The application derives tenant
 * scope from the authenticated actor context instead of trusting client input.
 */
export class RequestReservationInputGql {
  @Field(() => ID)
  screeningId!: string;

  @Field(() => [ID])
  seatIds!: string[];
}
