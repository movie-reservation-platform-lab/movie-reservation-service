import type { ClaimedReservationRequest } from '../../../application/movie-reservations/claimed-reservation-request';
import type {
  ClaimNextPendingReservationRequestInput,
  ConfirmClaimedReservationRequestResult,
  HeartbeatClaimedReservationRequestInput,
  ReservationRequestWorkRepository,
} from '../../../application/movie-reservations/ports/reservation-request-work-repository';
import type {
  ConfirmedReservationRequestProcessingAttempt,
  FailedReservationRequestProcessingAttempt,
  RejectedReservationRequestProcessingAttempt,
  ReservationRequestProcessingAttempt,
} from '../../../application/movie-reservations/reservation-request-processing-attempt';
import type { Reservation } from '../../../domain/movie-reservations/reservation';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';
import {
  confirmReservationRequest,
  failReservationRequest,
  rejectReservationRequest,
  startProcessingReservationRequest,
} from '../../../domain/movie-reservations/reservation-request-transitions';
import type { ScreeningId } from '../../../domain/movie-reservations/screening-id';
import type { SeatId } from '../../../domain/movie-reservations/seat-id';
import type { InMemoryMovieReservationStore } from './in-memory-movie-reservation.store';

export class InMemoryReservationRequestWorkRepository implements ReservationRequestWorkRepository {
  constructor(private readonly store: InMemoryMovieReservationStore) {}

  /**
   * Claims the lowest-sequence REQUESTED item by scanning the fake store.
   *
   * This linear scan is acceptable for D5 in-memory storage. A durable adapter
   * should use an indexed query plus an atomic lock/update so multiple workers
   * cannot claim the same request.
   */
  async claimNextPendingReservationRequest(
    input: ClaimNextPendingReservationRequestInput,
  ): Promise<ClaimedReservationRequest | null> {
    let nextWorkItem: ClaimedReservationRequest | null = null;

    for (const reservationRequest of this.store.reservationRequestsById.values()) {
      const metadata = this.store.getReservationRequestWorkMetadata(reservationRequest.id);

      if (
        reservationRequest.status === ReservationRequestStatus.REQUESTED &&
        metadata.transientFailureCount >= input.maxTransientFailures
      ) {
        continue;
      }

      if (
        reservationRequest.status !== ReservationRequestStatus.REQUESTED &&
        !isExpiredProcessingRequest(reservationRequest, metadata, input.claimedAt)
      ) {
        continue;
      }

      if (nextWorkItem === null || metadata.sequence < nextWorkItem.sequence) {
        const isLeaseTimeoutReclaim = isExpiredProcessingRequest(reservationRequest, metadata, input.claimedAt);

        nextWorkItem = {
          reservationRequest,
          sequence: metadata.sequence,
          claimedBy: input.workerId,
          claimToken: input.claimToken,
          claimedAt: input.claimedAt,
          claimExpiresAt: input.claimExpiresAt,
          leaseTimeoutCount: metadata.leaseTimeoutCount + (isLeaseTimeoutReclaim ? 1 : 0),
          transientFailureCount: metadata.transientFailureCount,
        };
      }
    }

    if (nextWorkItem === null) {
      return null;
    }

    const selectedMetadata = this.store.getReservationRequestWorkMetadata(nextWorkItem.reservationRequest.id);
    const isLeaseTimeoutReclaim = isExpiredProcessingRequest(
      nextWorkItem.reservationRequest,
      selectedMetadata,
      input.claimedAt,
    );

    if (isLeaseTimeoutReclaim && selectedMetadata.leaseTimeoutCount >= input.maxLeaseTimeouts) {
      this.failExpiredClaimAfterLeaseTimeoutBudget(nextWorkItem.reservationRequest, input.claimedAt);
      return null;
    }

    const processingReservationRequest =
      nextWorkItem.reservationRequest.status === ReservationRequestStatus.PROCESSING
        ? nextWorkItem.reservationRequest
        : startProcessingReservationRequest(nextWorkItem.reservationRequest);

    this.store.reservationRequestsById.set(processingReservationRequest.id, processingReservationRequest);
    this.store.updateReservationRequestWorkMetadata(processingReservationRequest.id, {
      sequence: nextWorkItem.sequence,
      leaseTimeoutCount: nextWorkItem.leaseTimeoutCount,
      transientFailureCount: nextWorkItem.transientFailureCount,
      claimedBy: input.workerId,
      claimToken: input.claimToken,
      claimedAt: input.claimedAt,
      claimExpiresAt: input.claimExpiresAt,
      lastHeartbeatAt: input.claimedAt,
    });

    return {
      reservationRequest: processingReservationRequest,
      sequence: nextWorkItem.sequence,
      claimedBy: input.workerId,
      claimToken: input.claimToken,
      claimedAt: input.claimedAt,
      claimExpiresAt: input.claimExpiresAt,
      leaseTimeoutCount: nextWorkItem.leaseTimeoutCount,
      transientFailureCount: nextWorkItem.transientFailureCount,
    };
  }

  async heartbeatClaimedReservationRequest(input: HeartbeatClaimedReservationRequestInput): Promise<boolean> {
    const currentRequest = this.store.reservationRequestsById.get(input.claimedWorkItem.reservationRequest.id);

    if (currentRequest === undefined || currentRequest.status !== ReservationRequestStatus.PROCESSING) {
      return false;
    }

    const metadata = this.store.getReservationRequestWorkMetadata(currentRequest.id);

    if (
      metadata.claimedBy !== input.claimedWorkItem.claimedBy ||
      metadata.claimToken !== input.claimedWorkItem.claimToken
    ) {
      return false;
    }

    this.store.updateReservationRequestWorkMetadata(currentRequest.id, {
      ...metadata,
      claimExpiresAt: input.claimExpiresAt,
      lastHeartbeatAt: input.heartbeatAt,
    });

    return true;
  }

  async findConflictingConfirmedReservation(input: {
    readonly screeningId: ScreeningId;
    readonly seatIds: readonly SeatId[];
  }): Promise<Reservation | null> {
    const requestedSeatIds = new Set(input.seatIds);

    for (const reservation of this.store.reservationsById.values()) {
      if (reservation.screeningId !== input.screeningId) {
        continue;
      }

      if (reservation.seatIds.some((seatId) => requestedSeatIds.has(seatId))) {
        return reservation;
      }
    }

    return null;
  }

  async confirmClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reservation: Reservation;
    readonly attempt: ConfirmedReservationRequestProcessingAttempt;
  }): Promise<ConfirmClaimedReservationRequestResult> {
    const currentRequest = this.requireClaimedProcessingRequest(input.claimedWorkItem);

    if (this.store.reservationsById.has(input.reservation.id)) {
      throw new Error(`Reservation ${input.reservation.id} already exists`);
    }

    const conflict = await this.findConflictingConfirmedReservation({
      screeningId: input.reservation.screeningId,
      seatIds: input.reservation.seatIds,
    });

    if (conflict !== null) {
      const rejectedRequest = rejectReservationRequest(currentRequest);
      const rejectedAttempt: RejectedReservationRequestProcessingAttempt = {
        reservationRequestId: currentRequest.id,
        sequence: input.claimedWorkItem.sequence,
        startedAt: input.attempt.startedAt,
        completedAt: input.attempt.completedAt,
        outcome: 'rejected',
        reason: 'seat-conflict',
        conflictingReservationId: conflict.id,
      };

      this.store.reservationRequestsById.set(rejectedRequest.id, rejectedRequest);
      this.clearClaimMetadata(rejectedRequest.id);
      this.store.recordProcessingAttempt(rejectedAttempt);

      return {
        outcome: 'rejected',
        reservationRequest: rejectedRequest,
        attempt: rejectedAttempt,
      };
    }

    const confirmedRequest = confirmReservationRequest(currentRequest);
    this.store.reservationsById.set(input.reservation.id, input.reservation);
    this.store.reservationRequestsById.set(confirmedRequest.id, confirmedRequest);
    this.clearClaimMetadata(confirmedRequest.id);
    this.store.recordProcessingAttempt(input.attempt);

    return {
      outcome: 'confirmed',
      reservationRequest: confirmedRequest,
    };
  }

  async rejectClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'seat-conflict';
    readonly attempt: RejectedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    const currentRequest = this.requireClaimedProcessingRequest(input.claimedWorkItem);
    // Short-term D5 behavior: reject the whole request on any seat conflict.
    // This keeps the processor contract small while we are still in memory.
    // Revisit before a user-facing production flow; partial acceptance or
    // user choice matters when only some requested seats are unavailable.
    const rejectedRequest = rejectReservationRequest(currentRequest);
    this.store.reservationRequestsById.set(rejectedRequest.id, rejectedRequest);
    this.clearClaimMetadata(rejectedRequest.id);
    this.store.recordProcessingAttempt(input.attempt);

    return rejectedRequest;
  }

  async releaseClaimedReservationRequestForRetry(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    const currentRequest = this.requireClaimedProcessingRequest(input.claimedWorkItem);
    const retryableRequest: ReservationRequest = {
      ...currentRequest,
      status: ReservationRequestStatus.REQUESTED,
    };

    this.store.reservationRequestsById.set(retryableRequest.id, retryableRequest);
    this.incrementTransientFailureCount(retryableRequest.id);
    this.clearClaimMetadata(retryableRequest.id);
    this.store.recordProcessingAttempt(input.attempt);

    return retryableRequest;
  }

  async failClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    const currentRequest = this.requireClaimedProcessingRequest(input.claimedWorkItem);
    const failedRequest = failReservationRequest(currentRequest);
    this.store.reservationRequestsById.set(failedRequest.id, failedRequest);
    this.incrementTransientFailureCount(failedRequest.id);
    this.clearClaimMetadata(failedRequest.id);
    this.store.recordProcessingAttempt(input.attempt);

    return failedRequest;
  }

  async findReservationRequestProcessingAttemptsByRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<readonly ReservationRequestProcessingAttempt[]> {
    return [...(this.store.processingAttemptsByReservationRequestId.get(reservationRequestId) ?? [])];
  }

  private requireClaimedProcessingRequest(claimedWorkItem: ClaimedReservationRequest): ReservationRequest {
    const currentRequest = this.store.reservationRequestsById.get(claimedWorkItem.reservationRequest.id);

    if (currentRequest === undefined) {
      throw new Error(`Claimed reservation request ${claimedWorkItem.reservationRequest.id} was not found`);
    }

    const storedSequence = this.store.getReservationRequestSequence(claimedWorkItem.reservationRequest.id);
    const metadata = this.store.getReservationRequestWorkMetadata(claimedWorkItem.reservationRequest.id);

    if (storedSequence !== claimedWorkItem.sequence) {
      throw new Error(`Claimed reservation request ${claimedWorkItem.reservationRequest.id} sequence changed`);
    }

    if (metadata.claimedBy !== claimedWorkItem.claimedBy || metadata.claimToken !== claimedWorkItem.claimToken) {
      throw new Error(`Claimed reservation request ${claimedWorkItem.reservationRequest.id} claim was lost`);
    }

    if (currentRequest.status !== ReservationRequestStatus.PROCESSING) {
      throw new Error(`Claimed reservation request ${currentRequest.id} is ${currentRequest.status}, not PROCESSING`);
    }

    return currentRequest;
  }

  private clearClaimMetadata(reservationRequestId: ReservationRequestId): void {
    const metadata = this.store.getReservationRequestWorkMetadata(reservationRequestId);

    this.store.updateReservationRequestWorkMetadata(reservationRequestId, {
      sequence: metadata.sequence,
      leaseTimeoutCount: metadata.leaseTimeoutCount,
      transientFailureCount: metadata.transientFailureCount,
    });
  }

  private incrementTransientFailureCount(reservationRequestId: ReservationRequestId): void {
    const metadata = this.store.getReservationRequestWorkMetadata(reservationRequestId);

    this.store.updateReservationRequestWorkMetadata(reservationRequestId, {
      ...metadata,
      transientFailureCount: metadata.transientFailureCount + 1,
    });
  }

  private failExpiredClaimAfterLeaseTimeoutBudget(reservationRequest: ReservationRequest, failedAt: string): void {
    const failedRequest = failReservationRequest(reservationRequest);
    const metadata = this.store.getReservationRequestWorkMetadata(reservationRequest.id);

    this.store.reservationRequestsById.set(failedRequest.id, failedRequest);
    this.store.updateReservationRequestWorkMetadata(failedRequest.id, {
      sequence: metadata.sequence,
      leaseTimeoutCount: metadata.leaseTimeoutCount,
      transientFailureCount: metadata.transientFailureCount,
    });
    this.store.recordProcessingAttempt({
      reservationRequestId: reservationRequest.id,
      sequence: metadata.sequence,
      startedAt: failedAt,
      completedAt: failedAt,
      outcome: 'failed',
      reason: 'lease-timeout',
    });
  }
}

function isExpiredProcessingRequest(
  reservationRequest: ReservationRequest,
  metadata: {
    readonly claimExpiresAt?: string;
  },
  now: string,
): boolean {
  return (
    reservationRequest.status === ReservationRequestStatus.PROCESSING &&
    (metadata.claimExpiresAt === undefined || new Date(metadata.claimExpiresAt).getTime() <= new Date(now).getTime())
  );
}
