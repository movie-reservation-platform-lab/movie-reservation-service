import { type Provider } from '@nestjs/common';

import { AuthorizationService } from '../../application/authorization/authorization.service';
import { InProcessReservationRequestProcessor } from '../../application/movie-reservations/in-process-reservation-request-processor';
import { MovieReservationsService } from '../../application/movie-reservations/movie-reservations.service';
import type { Clock } from '../../application/movie-reservations/ports/clock';
import type { MovieReservationRepository } from '../../application/movie-reservations/ports/movie-reservation-repository';
import type { ReservationIdGenerator } from '../../application/movie-reservations/ports/reservation-id-generator';
import type { ReservationRequestIdGenerator } from '../../application/movie-reservations/ports/reservation-request-id-generator';
import type { ReservationRequestProcessor } from '../../application/movie-reservations/ports/reservation-request-processor';
import type { ReservationRequestWorkRepository } from '../../application/movie-reservations/ports/reservation-request-work-repository';
import { config } from '../../config';
import { RandomReservationIdGenerator } from '../../infrastructure/movie-reservations/random-reservation-id-generator';
import { RandomReservationRequestIdGenerator } from '../../infrastructure/movie-reservations/random-reservation-request-id-generator';
import { SystemClock } from '../../infrastructure/movie-reservations/system-clock';
import {
  CLOCK,
  MOVIE_RESERVATION_REPOSITORY,
  RESERVATION_ID_GENERATOR,
  RESERVATION_REQUEST_ID_GENERATOR,
  RESERVATION_REQUEST_PROCESSOR,
  RESERVATION_REQUEST_WORK_REPOSITORY,
} from './movie-reservation.tokens';

export function createMovieReservationUseCaseProviders(): Provider[] {
  return [
    AuthorizationService,
    {
      provide: RESERVATION_ID_GENERATOR,
      useFactory: (): ReservationIdGenerator =>
        new RandomReservationIdGenerator(),
    },
    {
      provide: RESERVATION_REQUEST_ID_GENERATOR,
      useFactory: (): ReservationRequestIdGenerator =>
        new RandomReservationRequestIdGenerator(),
    },
    {
      provide: CLOCK,
      useFactory: (): Clock => new SystemClock(),
    },
    {
      provide: RESERVATION_REQUEST_PROCESSOR,
      useFactory: (
        workRepository: ReservationRequestWorkRepository,
        reservationIdGenerator: ReservationIdGenerator,
        clock: Clock,
      ): ReservationRequestProcessor =>
        new InProcessReservationRequestProcessor(
          workRepository,
          reservationIdGenerator,
          clock,
          {
            workerId: 'fake-in-process-reservation-worker',
            claimLeaseMs: config.RESERVATION_WORKER_LEASE_MS,
            maxLeaseTimeouts: config.RESERVATION_WORKER_MAX_LEASE_TIMEOUTS,
            maxTransientFailures:
              config.RESERVATION_WORKER_MAX_TRANSIENT_FAILURES,
          },
        ),
      inject: [
        RESERVATION_REQUEST_WORK_REPOSITORY,
        RESERVATION_ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: MovieReservationsService,
      useFactory: (
        repository: MovieReservationRepository,
        authorizationService: AuthorizationService,
        reservationRequestIdGenerator: ReservationRequestIdGenerator,
      ): MovieReservationsService =>
        new MovieReservationsService(
          repository,
          authorizationService,
          reservationRequestIdGenerator,
        ),
      inject: [
        MOVIE_RESERVATION_REPOSITORY,
        AuthorizationService,
        RESERVATION_REQUEST_ID_GENERATOR,
      ],
    },
  ];
}
