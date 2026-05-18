import { createNonEmptyId } from './id-utils';

declare const reservationIdBrand: unique symbol;

/**
 * Identifier for a confirmed reservation.
 *
 * A reservation is the durable result produced after a reservation request is
 * accepted and confirmed.
 */
export type ReservationId = string & {
  readonly [reservationIdBrand]: 'ReservationId';
};

export function createReservationId(value: string): ReservationId {
  return createNonEmptyId<ReservationId>(value, 'ReservationId');
}
