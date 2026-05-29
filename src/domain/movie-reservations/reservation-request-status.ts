/**
 * Lifecycle states for an asynchronous reservation request.
 *
 * Currently `FAILED` is treated as terminal and does not retry automatically. Durable
 * worker phases should add retry policy, claim leases, and dead-letter handling.
 */
export enum ReservationRequestStatus {
  REQUESTED = 'REQUESTED',
  PROCESSING = 'PROCESSING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}
