import type { ReservationProcessingFailurePolicy } from './ports/reservation-processing-failure-policy';

/**
 * Safe default for normal local and platform runtime.
 */
export class DisabledReservationProcessingFailurePolicy implements ReservationProcessingFailurePolicy {
  shouldFailReservationProcessing(): boolean {
    return false;
  }
}
