import { createHash } from 'node:crypto';

import type {
  ReservationProcessingFailurePolicy,
  ReservationProcessingFailurePolicyInput,
} from '../../application/movie-reservations/ports/reservation-processing-failure-policy';

export interface StableRandomReservationProcessingFailurePolicyOptions {
  readonly failureRate: number;
  readonly salt: string;
}

/**
 * Stable random policy for demo/on-call failure simulation.
 *
 * The same reservation request id and salt always produce the same decision,
 * so retries reproduce the same bug instead of behaving like pure noise.
 */
export class StableRandomReservationProcessingFailurePolicy implements ReservationProcessingFailurePolicy {
  constructor(private readonly options: StableRandomReservationProcessingFailurePolicyOptions) {
    if (options.failureRate < 0 || options.failureRate > 1) {
      throw new Error('failureRate must be between 0 and 1');
    }

    if (options.salt.length === 0) {
      throw new Error('salt cannot be empty');
    }
  }

  shouldFailReservationProcessing(input: ReservationProcessingFailurePolicyInput): boolean {
    return createStableScore(this.options.salt, input.reservationRequestId) < this.options.failureRate;
  }
}

function createStableScore(salt: string, reservationRequestId: string): number {
  const digest = createHash('sha256').update(`${salt}:${reservationRequestId}`).digest();

  return digest.readUInt32BE(0) / 4_294_967_296;
}
