import type { Knex } from 'knex';

import type { ClaimedReservationRequest } from '../../../application/movie-reservations/claimed-reservation-request';
import type {
  ConfirmedReservationRequestProcessingAttempt,
  FailedReservationRequestProcessingAttempt,
  RejectedReservationRequestProcessingAttempt,
  ReservationRequestProcessingAttempt,
} from '../../../application/movie-reservations/reservation-request-processing-attempt';
import type { ReservationRequest } from '../../../domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import type { ReservationRequestId } from '../../../domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';
import {
  type ReservationRequestProcessingAttemptRow,
  type ReservationRequestRow,
  toReservationRequest,
  toReservationRequestProcessingAttempt,
  toReservationRequestSequence,
} from './postgres-mappers';
import { findReservationRequestSeatIds } from './postgres-reservation-seat-lookup';
import { requireSingleRow } from './postgres-row-utils';

type ClaimedRequestTargetStatus =
  | ReservationRequestStatus.REQUESTED
  | ReservationRequestStatus.CONFIRMED
  | ReservationRequestStatus.REJECTED
  | ReservationRequestStatus.FAILED;

/**
 * Postgres row operations for reservation request state transitions.
 *
 * This helper owns claim ownership checks, status updates, transient-failure
 * counter updates, and immutable processing-attempt audit rows.
 */
export class PostgresReservationRequestStateStore {
  constructor(private readonly database: Knex) {}

  /**
   * Marks an owned PROCESSING request as CONFIRMED after the reservation rows
   * have been inserted in the same transaction.
   */
  async markClaimedReservationRequestConfirmed(input: {
    readonly trx: Knex.Transaction;
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly attempt: ConfirmedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    const confirmedRequest = await this.updateClaimedRequestStatus(
      input.trx,
      input.claimedWorkItem,
      ReservationRequestStatus.CONFIRMED,
    );
    await this.insertProcessingAttempt(input.trx, input.attempt);

    return confirmedRequest;
  }

  /**
   * Marks an owned PROCESSING request as REJECTED after a confirmed seat conflict.
   */
  async rejectClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'seat-conflict';
    readonly attempt: RejectedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    return this.database.transaction(async (trx) => {
      await this.requireClaimedProcessingRequest(trx, input.claimedWorkItem);
      const rejectedRequest = await this.updateClaimedRequestStatus(
        trx,
        input.claimedWorkItem,
        ReservationRequestStatus.REJECTED,
      );
      await this.insertProcessingAttempt(trx, input.attempt);

      return rejectedRequest;
    });
  }

  /**
   * Records a transient processor failure and returns the request to REQUESTED.
   */
  async releaseClaimedReservationRequestForRetry(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    return this.database.transaction(async (trx) => {
      await this.requireClaimedProcessingRequest(trx, input.claimedWorkItem);
      const retryableRequest = await this.updateClaimedRequestStatus(
        trx,
        input.claimedWorkItem,
        ReservationRequestStatus.REQUESTED,
        { incrementTransientFailureCount: true },
      );
      await this.insertProcessingAttempt(trx, input.attempt);

      return retryableRequest;
    });
  }

  /**
   * Records the final transient processor failure and marks the request FAILED.
   */
  async failClaimedReservationRequest(input: {
    readonly claimedWorkItem: ClaimedReservationRequest;
    readonly reason: 'unexpected-error';
    readonly attempt: FailedReservationRequestProcessingAttempt;
  }): Promise<ReservationRequest> {
    return this.database.transaction(async (trx) => {
      await this.requireClaimedProcessingRequest(trx, input.claimedWorkItem);
      const failedRequest = await this.updateClaimedRequestStatus(
        trx,
        input.claimedWorkItem,
        ReservationRequestStatus.FAILED,
        { incrementTransientFailureCount: true },
      );
      await this.insertProcessingAttempt(trx, input.attempt);

      return failedRequest;
    });
  }

  /**
   * Reads processing-attempt history in append order for tests and diagnostics.
   */
  async findReservationRequestProcessingAttemptsByRequestId(
    reservationRequestId: ReservationRequestId,
  ): Promise<readonly ReservationRequestProcessingAttempt[]> {
    const rows = await this.database<ReservationRequestProcessingAttemptRow>(
      'reservation_request_processing_attempts',
    )
      .where({ reservation_request_id: reservationRequestId })
      .orderBy('id', 'asc');

    return rows.map(toReservationRequestProcessingAttempt);
  }

  /**
   * Marks an expired PROCESSING request as permanently failed when the lease
   * timeout budget has already been exhausted.
   */
  async failExpiredClaimAfterLeaseTimeoutBudget(
    trx: Knex.Transaction,
    row: ReservationRequestRow,
    failedAt: string,
  ): Promise<void> {
    await trx<ReservationRequestRow>('reservation_requests')
      .where({ id: row.id })
      .update({
        status: ReservationRequestStatus.FAILED,
        claimed_by: null,
        claim_token: null,
        claimed_at: null,
        claim_expires_at: null,
        last_heartbeat_at: null,
        processed_at: failedAt,
        updated_at: failedAt,
      });
    await this.insertProcessingAttempt(trx, {
      reservationRequestId: createReservationRequestId(row.id),
      sequence: toReservationRequestSequence(row.sequence),
      startedAt: failedAt,
      completedAt: failedAt,
      outcome: 'failed',
      reason: 'lease-timeout',
    });
  }

  /**
   * Re-checks claim ownership inside a transaction before mutating the row.
   *
   * This protects the worker from completing work after another worker has
   * reclaimed the request or after the request has already become terminal.
   */
  async requireClaimedProcessingRequest(
    trx: Knex.Transaction,
    claimedWorkItem: ClaimedReservationRequest,
  ): Promise<ReservationRequestRow> {
    const row = await trx<ReservationRequestRow>('reservation_requests')
      .where({ id: claimedWorkItem.reservationRequest.id })
      .forUpdate()
      .first();

    if (row === undefined) {
      throw new Error(
        `Claimed reservation request ${claimedWorkItem.reservationRequest.id} was not found`,
      );
    }

    const storedSequence = toReservationRequestSequence(row.sequence);

    if (storedSequence !== claimedWorkItem.sequence) {
      throw new Error(
        `Claimed reservation request ${claimedWorkItem.reservationRequest.id} sequence changed`,
      );
    }

    const processingStatus: string = ReservationRequestStatus.PROCESSING;

    if (row.status !== processingStatus) {
      throw new Error(
        `Claimed reservation request ${row.id} is ${row.status}, not PROCESSING`,
      );
    }

    if (
      row.claimed_by !== claimedWorkItem.claimedBy ||
      row.claim_token !== claimedWorkItem.claimToken
    ) {
      throw new Error(`Claimed reservation request ${row.id} claim was lost`);
    }

    return row;
  }

  /**
   * Applies the shared state-transition write for a currently claimed request.
   *
   * Any transition away from PROCESSING clears the lease columns. Returning to
   * REQUESTED keeps `processed_at` null because the request is not terminal yet.
   */
  private async updateClaimedRequestStatus(
    trx: Knex.Transaction,
    claimedWorkItem: ClaimedReservationRequest,
    status: ClaimedRequestTargetStatus,
    options: { readonly incrementTransientFailureCount?: boolean } = {},
  ): Promise<ReservationRequest> {
    const terminalTimestamp =
      status === ReservationRequestStatus.REQUESTED ? null : trx.fn.now();
    const updatedRows = await trx<ReservationRequestRow>('reservation_requests')
      .where({ id: claimedWorkItem.reservationRequest.id })
      .update({
        status,
        claimed_by: null,
        claim_token: null,
        claimed_at: null,
        claim_expires_at: null,
        last_heartbeat_at: null,
        ...(options.incrementTransientFailureCount === true
          ? { transient_failure_count: trx.raw('transient_failure_count + 1') }
          : {}),
        processed_at: terminalTimestamp,
        updated_at: trx.fn.now(),
      })
      .returning('*');
    const updatedRow = requireSingleRow(
      updatedRows,
      `Reservation request ${claimedWorkItem.reservationRequest.id} was not updated`,
    );

    return toReservationRequest(
      updatedRow,
      await findReservationRequestSeatIds(trx, updatedRow.id),
    );
  }

  /**
   * Appends the immutable audit row describing how this processing attempt
   * ended: confirmed, rejected for a conflict, or failed.
   */
  private async insertProcessingAttempt(
    trx: Knex.Transaction,
    attempt: ReservationRequestProcessingAttempt,
  ): Promise<void> {
    await trx('reservation_request_processing_attempts').insert({
      reservation_request_id: attempt.reservationRequestId,
      reservation_request_sequence: attempt.sequence,
      started_at: attempt.startedAt,
      completed_at: attempt.completedAt,
      outcome: attempt.outcome,
      reason: readAttemptReason(attempt),
      reservation_id:
        attempt.outcome === 'confirmed' ? attempt.reservationId : null,
      conflicting_reservation_id:
        attempt.outcome === 'rejected'
          ? attempt.conflictingReservationId
          : null,
    });
  }
}

/**
 * Extracts the nullable database `reason` value from the discriminated attempt.
 */
function readAttemptReason(
  attempt: ReservationRequestProcessingAttempt,
): string | null {
  if (attempt.outcome === 'confirmed') {
    return null;
  }

  return attempt.reason;
}
