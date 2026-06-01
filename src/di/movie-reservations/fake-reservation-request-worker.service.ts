import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import type { ClaimedReservationRequest } from '../../application/movie-reservations/claimed-reservation-request';
import type { Clock } from '../../application/movie-reservations/ports/clock';
import type { ReservationRequestProcessor } from '../../application/movie-reservations/ports/reservation-request-processor';
import type { ReservationRequestWorkRepository } from '../../application/movie-reservations/ports/reservation-request-work-repository';
import {
  CLOCK,
  RESERVATION_REQUEST_PROCESSOR,
  RESERVATION_REQUEST_WORK_REPOSITORY,
  RESERVATION_WORKER_OPTIONS,
} from './movie-reservation.tokens';

/**
 * Timer settings for the local in-process reservation worker.
 */
export interface FakeReservationRequestWorkerOptions {
  /** Delay before checking for the next claimable reservation request. */
  readonly pollIntervalMs: number;
  /** Duration each claim remains owned before it must be heartbeated. */
  readonly claimLeaseMs: number;
  /** Frequency used to renew the active claim while processing is in flight. */
  readonly heartbeatIntervalMs: number;
}

/**
 * Local fake data-plane adapter for reservation processing.
 *
 * It lives in the Nest edge because it owns timers and lifecycle hooks, while
 * reservation workflow behavior stays in the application processor. A future
 * control-plane/data-plane split can move this adapter into a separate worker
 * package, process, or service without changing the GraphQL API use cases.
 */
@Injectable()
export class FakeReservationRequestWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private pollTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private stopping = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    @Inject(RESERVATION_REQUEST_PROCESSOR)
    private readonly processor: ReservationRequestProcessor,
    @Inject(RESERVATION_REQUEST_WORK_REPOSITORY)
    private readonly workRepository: ReservationRequestWorkRepository,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(RESERVATION_WORKER_OPTIONS)
    private readonly options: FakeReservationRequestWorkerOptions,
  ) {}

  /**
   * Starts the local worker loop after Nest has created all providers.
   */
  onApplicationBootstrap(): void {
    this.scheduleNextPoll(0);
  }

  /**
   * Stops timers and waits for the current processing attempt before shutdown.
   */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.clearPollTimer();
    this.clearHeartbeatTimer();

    if (this.inFlight !== undefined) {
      await this.inFlight;
    }
  }

  /**
   * Schedules one polling pass; the next pass is scheduled after it finishes.
   */
  private scheduleNextPoll(delayMs: number): void {
    if (this.stopping) {
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.inFlight = this.processOneWorkItem()
        .catch(() => {
          // The fake worker keeps local development moving after an internal
          // processor error. The attempt itself is recorded by the repository.
        })
        .finally(() => {
          this.inFlight = undefined;
          this.scheduleNextPoll(this.options.pollIntervalMs);
        });
    }, delayMs);
    this.pollTimer.unref?.();
  }

  /**
   * Processes at most one reservation request and heartbeats while it is owned.
   */
  private async processOneWorkItem(): Promise<void> {
    let claimedWorkItem: ClaimedReservationRequest | null = null;

    this.heartbeatTimer = setInterval(() => {
      if (claimedWorkItem === null) {
        return;
      }

      void this.heartbeat(claimedWorkItem);
    }, this.options.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();

    try {
      await this.processor.processNextPendingRequest({
        claimToken: randomUUID(),
        onClaimed: (workItem) => {
          claimedWorkItem = workItem;
        },
      });
    } finally {
      this.clearHeartbeatTimer();
    }
  }

  /**
   * Renews the active claim lease, stopping heartbeats if ownership was lost.
   */
  private async heartbeat(
    claimedWorkItem: ClaimedReservationRequest,
  ): Promise<void> {
    const heartbeatAt = this.clock.nowIsoString();
    const renewed =
      await this.workRepository.heartbeatClaimedReservationRequest({
        claimedWorkItem,
        heartbeatAt,
        claimExpiresAt: addMilliseconds(heartbeatAt, this.options.claimLeaseMs),
      });

    if (!renewed) {
      this.clearHeartbeatTimer();
    }
  }

  /**
   * Clears the pending poll timer so no new work starts.
   */
  private clearPollTimer(): void {
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Clears the active heartbeat timer for the current claim.
   */
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

/**
 * Returns an ISO timestamp after adding a duration to another ISO timestamp.
 */
function addMilliseconds(isoString: string, milliseconds: number): string {
  return new Date(new Date(isoString).getTime() + milliseconds).toISOString();
}
