import { createUuidId } from './id-utils';

declare const screeningIdBrand: unique symbol;

/**
 * Identifier for a scheduled movie showing.
 *
 * Screenings connect a movie, auditorium, time window, and movie provider.
 */
export type ScreeningId = string & {
  readonly [screeningIdBrand]: 'ScreeningId';
};

export function createScreeningId(value: string): ScreeningId {
  return createUuidId<ScreeningId>(value, 'ScreeningId');
}
