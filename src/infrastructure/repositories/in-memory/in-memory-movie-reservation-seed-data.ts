import { createMovieReservationDemoData } from '../../fixtures/movie-reservations/movie-reservation-demo-data';
import type { InMemoryMovieReservationStoreInput } from './in-memory-movie-reservation.store';

/**
 * Local/demo seed data for the in-memory movie reservation store.
 *
 * The fake store owns persistence behavior. Shared demo data keeps in-memory
 * and Postgres local/test seeds aligned while each adapter owns its write path.
 */
export function createInMemoryMovieReservationSeedData(): InMemoryMovieReservationStoreInput {
  return createMovieReservationDemoData();
}
