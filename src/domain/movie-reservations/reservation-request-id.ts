import { createNonEmptyId } from './id-utils';

declare const reservationRequestIdBrand: unique symbol;

/**
 * Identifier for an asynchronous reservation request.
 *
 * Request ids track the lifecycle before a reservation is confirmed, rejected,
 * or failed.
 */
export type ReservationRequestId = string & {
  readonly [reservationRequestIdBrand]: 'ReservationRequestId';
};

export function createReservationRequestId(
  value: string,
): ReservationRequestId {
  return createNonEmptyId<ReservationRequestId>(value, 'ReservationRequestId');
}
