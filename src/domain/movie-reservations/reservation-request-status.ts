/**
 * Lifecycle states for an asynchronous reservation request.
 */
export enum ReservationRequestStatus {
  REQUESTED = 'REQUESTED',
  PROCESSING = 'PROCESSING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}
