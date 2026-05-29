import type { ClaimedReservationRequest } from '../../../application/movie-reservations/claimed-reservation-request';
import type { ReservationRequestWorkRepository } from '../../../application/movie-reservations/ports/reservation-request-work-repository';
import type { ReservationRequestProcessingAttempt } from '../../../application/movie-reservations/reservation-request-processing-attempt';
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
  async claimNextPendingReservationRequest(): Promise<ClaimedReservationRequest | null> {
    let nextWorkItem: ClaimedReservationRequest | null = null;

    for (const reservationRequest of this.store.reservationRequestsById.values()) {
      if (reservationRequest.status !== ReservationRequestStatus.REQUESTED) {
        continue;
      }

      const sequence = this.store.getReservationRequestSequence(
        reservationRequest.id,
      );

      if (nextWorkItem === null || sequence < nextWorkItem.sequence) {
        nextWorkItem = { reservationRequest, sequence };
      }
    }

    if (nextWorkItem === null) {
      return null;
    }

    const processingReservationRequest = startProcessingReservationRequest(
      nextWorkItem.reservationRequest,
    );

    this.store.reservationRequestsById.set(
      processingReservationRequest.id,
      processingReservationRequest,
    );

    return {
      reservationRequest: processingReservationRequest,
      sequence: nextWorkItem.sequence,
    };
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
  }): Promise<ReservationRequest> {
    const currentRequest = this.requireClaimedProcessingRequest(
      input.claimedWorkItem,
    );

    if (this.store.reservationsById.has(input.reservation.id)) {
      throw new Error(`Reservation ${input.reservation.id} already exists`);
    }

    const confirmedRequest = confirmReservationRequest(currentRequest);
    this.store.reservationsById.set(input.reservation.id, input.reservation);
    this.store.reservationRequestsById.set(
      confirmedRequest.id,
      confirmedRequest,
    );

    return confirmedRequest;
  }

  async rejectClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'seat-conflict';
  }): Promise<ReservationRequest> {
    const currentRequest = this.requireClaimedProcessingRequest(
      input.claimedWorkItem,
    );
    // Short-term D5 behavior: reject the whole request on any seat conflict.
    // This keeps the processor contract small while we are still in memory.
    // Revisit before a user-facing production flow; partial acceptance or
    // user choice matters when only some requested seats are unavailable.
    const rejectedRequest = rejectReservationRequest(currentRequest);
    this.store.reservationRequestsById.set(rejectedRequest.id, rejectedRequest);

    return rejectedRequest;
  }

  async failClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
  }): Promise<ReservationRequest> {
    const currentRequest = this.requireClaimedProcessingRequest(
      input.claimedWorkItem,
    );
    const failedRequest = failReservationRequest(currentRequest);
    this.store.reservationRequestsById.set(failedRequest.id, failedRequest);

    return failedRequest;
  }

  async recordReservationRequestProcessingAttempt(
    attempt: ReservationRequestProcessingAttempt,
  ): Promise<void> {
    this.store.recordProcessingAttempt(attempt);
  }

  async findReservationRequestProcessingAttemptsByRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<readonly ReservationRequestProcessingAttempt[]> {
    return [
      ...(this.store.processingAttemptsByReservationRequestId.get(
        reservationRequestId,
      ) ?? []),
    ];
  }

  private requireClaimedProcessingRequest(
    claimedWorkItem: ClaimedReservationRequest,
  ): ReservationRequest {
    const currentRequest = this.store.reservationRequestsById.get(
      claimedWorkItem.reservationRequest.id,
    );

    if (currentRequest === undefined) {
      throw new Error(
        `Claimed reservation request ${claimedWorkItem.reservationRequest.id} was not found`,
      );
    }

    const storedSequence = this.store.getReservationRequestSequence(
      claimedWorkItem.reservationRequest.id,
    );

    if (storedSequence !== claimedWorkItem.sequence) {
      throw new Error(
        `Claimed reservation request ${claimedWorkItem.reservationRequest.id} sequence changed`,
      );
    }

    if (currentRequest.status !== ReservationRequestStatus.PROCESSING) {
      throw new Error(
        `Claimed reservation request ${currentRequest.id} is ${currentRequest.status}, not PROCESSING`,
      );
    }

    return currentRequest;
  }
}
