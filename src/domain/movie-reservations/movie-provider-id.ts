import { createNonEmptyId } from './id-utils';

declare const movieProviderIdBrand: unique symbol;

/**
 * Tenant/provider boundary for movie reservation data.
 *
 * At runtime this is a string; the brand prevents accidental mixups with other
 * ids during TypeScript compilation.
 */
export type MovieProviderId = string & {
  readonly [movieProviderIdBrand]: 'MovieProviderId';
};

export function createMovieProviderId(value: string): MovieProviderId {
  return createNonEmptyId<MovieProviderId>(value, 'MovieProviderId');
}
