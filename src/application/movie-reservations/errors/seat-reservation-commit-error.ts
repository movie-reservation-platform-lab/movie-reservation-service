/**
 * Diagnostic error for processor commit failures.
 *
 * The message intentionally avoids request-specific values. Logs and spans
 * already carry the reservation request id through structured fields.
 */
export class SeatReservationCommitError extends Error {
  constructor() {
    super('Seat reservation commit failed while finalizing the reservation.');
    this.name = 'SeatReservationCommitError';
  }
}
