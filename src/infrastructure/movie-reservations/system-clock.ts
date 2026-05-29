import type { Clock } from '../../application/movie-reservations/ports/clock';

export class SystemClock implements Clock {
  nowIsoString(): string {
    return new Date().toISOString();
  }
}
