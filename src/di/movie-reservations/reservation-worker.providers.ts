import { type Provider } from '@nestjs/common';

import { config, type ReservationWorkerMode } from '../../config';
import {
  FakeReservationRequestWorkerService,
  type FakeReservationRequestWorkerOptions,
} from './fake-reservation-request-worker.service';
import { RESERVATION_WORKER_OPTIONS } from './movie-reservation.tokens';

export function createReservationWorkerProviders(
  reservationWorkerMode: ReservationWorkerMode,
): Provider[] {
  if (reservationWorkerMode === 'disabled') {
    return [];
  }

  const workerOptions: FakeReservationRequestWorkerOptions = {
    pollIntervalMs: config.RESERVATION_WORKER_POLL_INTERVAL_MS,
    claimLeaseMs: config.RESERVATION_WORKER_LEASE_MS,
    heartbeatIntervalMs: config.RESERVATION_WORKER_HEARTBEAT_INTERVAL_MS,
  };

  return [
    {
      provide: RESERVATION_WORKER_OPTIONS,
      useValue: workerOptions,
    },
    FakeReservationRequestWorkerService,
  ];
}
