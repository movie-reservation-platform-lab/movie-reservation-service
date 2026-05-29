import { randomUUID } from 'node:crypto';

import type { ReservationRequestIdGenerator } from '../../application/movie-reservations/ports/reservation-request-id-generator';
import {
  createReservationRequestId,
  type ReservationRequestId,
} from '../../domain/movie-reservations/reservation-request-id';

/**
 * Runtime id generator for reservation requests created by the API process.
 */
export class RandomReservationRequestIdGenerator implements ReservationRequestIdGenerator {
  generateReservationRequestId(): ReservationRequestId {
    return createReservationRequestId(`request-${randomUUID()}`);
  }
}
