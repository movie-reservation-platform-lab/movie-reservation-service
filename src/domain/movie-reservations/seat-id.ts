import { createNonEmptyId } from './id-utils';

declare const seatIdBrand: unique symbol;

/**
 * Identifier for a seat in an auditorium.
 *
 * Seat ids stay provider-scoped through the surrounding seat and screening
 * records rather than by embedding tenant information in the id type.
 */
export type SeatId = string & {
  readonly [seatIdBrand]: 'SeatId';
};

export function createSeatId(value: string): SeatId {
  return createNonEmptyId<SeatId>(value, 'SeatId');
}
