import { describe, expect, it } from 'vitest';

import { createReservationRequestId } from '../../../src/domain/movie-reservations/reservation-request-id';
import { StableRandomReservationProcessingFailurePolicy } from '../../../src/infrastructure/movie-reservations/stable-random-reservation-processing-failure-policy';

describe('StableRandomReservationProcessingFailurePolicy', () => {
  it('uses a deterministic salted hash decision for the same reservation request id', () => {
    const policy = new StableRandomReservationProcessingFailurePolicy({
      failureRate: 0.4,
      salt: 'demo-salt',
    });

    const failingRequestId = createReservationRequestId('99999999-9999-4999-8999-999999999934');
    const passingRequestId = createReservationRequestId('99999999-9999-4999-8999-999999999930');

    expect(policy.shouldFailReservationProcessing({ reservationRequestId: failingRequestId })).toBe(true);
    expect(policy.shouldFailReservationProcessing({ reservationRequestId: failingRequestId })).toBe(true);
    expect(policy.shouldFailReservationProcessing({ reservationRequestId: passingRequestId })).toBe(false);
  });

  it('can be forced on for deterministic failure-path tests', () => {
    const policy = new StableRandomReservationProcessingFailurePolicy({
      failureRate: 1,
      salt: 'demo-salt',
    });

    expect(
      policy.shouldFailReservationProcessing({
        reservationRequestId: createReservationRequestId('99999999-9999-4999-8999-999999999930'),
      }),
    ).toBe(true);
  });

  it('rejects invalid options early', () => {
    expect(
      () =>
        new StableRandomReservationProcessingFailurePolicy({
          failureRate: 1.1,
          salt: 'demo-salt',
        }),
    ).toThrow('failureRate must be between 0 and 1');

    expect(
      () =>
        new StableRandomReservationProcessingFailurePolicy({
          failureRate: 0.4,
          salt: '',
        }),
    ).toThrow('salt cannot be empty');
  });
});
