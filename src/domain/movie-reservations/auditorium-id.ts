import { createUuidId } from './id-utils';

declare const auditoriumIdBrand: unique symbol;

/**
 * Identifier for a provider-owned auditorium.
 *
 * The brand prevents passing auditorium ids where seats, movies, or screenings
 * are expected.
 */
export type AuditoriumId = string & {
  readonly [auditoriumIdBrand]: 'AuditoriumId';
};

export function createAuditoriumId(value: string): AuditoriumId {
  return createUuidId<AuditoriumId>(value, 'AuditoriumId');
}
