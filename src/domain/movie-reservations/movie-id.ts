import { createNonEmptyId } from './id-utils';

declare const movieIdBrand: unique symbol;

/**
 * Identifier for a movie within the reservation domain.
 *
 * The branded string keeps movie ids distinct from screening, seat, and
 * reservation ids at compile time.
 */
export type MovieId = string & {
  readonly [movieIdBrand]: 'MovieId';
};

export function createMovieId(value: string): MovieId {
  return createNonEmptyId<MovieId>(value, 'MovieId');
}
