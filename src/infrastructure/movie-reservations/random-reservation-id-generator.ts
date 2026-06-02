import { randomUUID } from 'node:crypto';

import type { ReservationIdGenerator } from '../../application/movie-reservations/ports/reservation-id-generator';
import { createReservationId, type ReservationId } from '../../domain/movie-reservations/reservation-id';

export class RandomReservationIdGenerator implements ReservationIdGenerator {
  generateReservationId(): ReservationId {
    return createReservationId(randomUUID());
  }
}
