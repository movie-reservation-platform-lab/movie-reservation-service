import { type Provider } from '@nestjs/common';

import { DisabledReservationProcessingFailurePolicy } from '../../application/movie-reservations/disabled-reservation-processing-failure-policy';
import type { ReservationProcessingFailurePolicy } from '../../application/movie-reservations/ports/reservation-processing-failure-policy';
import type { ReservationFailureInjection } from '../../config';
import { StableRandomReservationProcessingFailurePolicy } from '../../infrastructure/movie-reservations/stable-random-reservation-processing-failure-policy';
import { RESERVATION_PROCESSING_FAILURE_POLICY } from './movie-reservation.tokens';

export function createReservationProcessingFailurePolicyProviders(
  failureInjection: ReservationFailureInjection,
): Provider[] {
  return [
    {
      provide: RESERVATION_PROCESSING_FAILURE_POLICY,
      useFactory: (): ReservationProcessingFailurePolicy => createReservationProcessingFailurePolicy(failureInjection),
    },
  ];
}

function createReservationProcessingFailurePolicy(
  failureInjection: ReservationFailureInjection,
): ReservationProcessingFailurePolicy {
  if (failureInjection.mode === 'disabled') {
    return new DisabledReservationProcessingFailurePolicy();
  }

  return new StableRandomReservationProcessingFailurePolicy({
    failureRate: failureInjection.failureRate,
    salt: failureInjection.salt,
  });
}
