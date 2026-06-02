import type { Knex } from 'knex';

import type { ClaimedReservationRequest } from '../../../application/movie-reservations/claimed-reservation-request';
import type {
  ClaimNextPendingReservationRequestInput,
  HeartbeatClaimedReservationRequestInput,
} from '../../../application/movie-reservations/ports/reservation-request-work-repository';
import { ReservationRequestStatus } from '../../../domain/movie-reservations/reservation-request-status';
import {
  type ReservationRequestRow,
  toIsoString,
  toReservationRequest,
  toReservationRequestSequence,
} from './postgres-mappers';
import type { PostgresReservationRequestStateStore } from './postgres-reservation-request-state-store';
import { findReservationRequestSeatIds } from './postgres-reservation-seat-lookup';
import { requireSingleRow } from './postgres-row-utils';

/**
 * Postgres claim and lease operations for reservation request workers.
 *
 * This helper owns the row-locking query, claim writes, heartbeat writes, and
 * lease-timeout budget handling. The public repository delegates here so its
 * workflow methods stay readable.
 */
export class PostgresReservationRequestClaimer {
  constructor(
    private readonly database: Knex,
    private readonly requestStateStore: PostgresReservationRequestStateStore,
  ) {}

  /**
   * Claims the oldest request that a worker may process right now.
   *
   * Example:
   * - worker A claims request R1 at 09:00:00 with a lease that expires at
   * 09:00:30.
   * - Worker B cannot claim R1 at 09:00:20 because the lease is still
   * active, but can reclaim it at 09:00:31 after the lease expires.
   * - If R1 has already exhausted its lease-timeout budget, the request is marked FAILED
   * instead of being claimed again.
   */
  async claimNextPendingReservationRequest(
    input: ClaimNextPendingReservationRequestInput,
  ): Promise<ClaimedReservationRequest | null> {
    return this.database.transaction(async (trx) => {
      const selectedReservationRequest = await this.findNextClaimableReservationRequestRow(trx, input);

      if (selectedReservationRequest === undefined) {
        return null;
      }

      const processingStatus: string = ReservationRequestStatus.PROCESSING;
      const isLeaseTimeoutReclaim = selectedReservationRequest.status === processingStatus;

      if (isLeaseTimeoutReclaim && Number(selectedReservationRequest.lease_timeout_count) >= input.maxLeaseTimeouts) {
        await this.requestStateStore.failExpiredClaimAfterLeaseTimeoutBudget(
          trx,
          selectedReservationRequest,
          input.claimedAt,
        );
        return null;
      }

      const updatedReservationRequest = await this.claimReservationRequestRow(trx, selectedReservationRequest, input, {
        incrementLeaseTimeoutCount: isLeaseTimeoutReclaim,
      });

      return {
        reservationRequest: toReservationRequest(
          updatedReservationRequest,
          await findReservationRequestSeatIds(trx, updatedReservationRequest.id),
        ),
        sequence: toReservationRequestSequence(updatedReservationRequest.sequence),
        claimedBy: input.workerId,
        claimToken: input.claimToken,
        claimedAt: toIsoString(updatedReservationRequest.claimed_at ?? input.claimedAt),
        claimExpiresAt: toIsoString(updatedReservationRequest.claim_expires_at ?? input.claimExpiresAt),
        leaseTimeoutCount: Number(updatedReservationRequest.lease_timeout_count),
        transientFailureCount: Number(updatedReservationRequest.transient_failure_count),
      };
    });
  }

  async heartbeatClaimedReservationRequest(input: HeartbeatClaimedReservationRequestInput): Promise<boolean> {
    const updatedRows = await this.database<ReservationRequestRow>('reservation_requests')
      .where({
        id: input.claimedWorkItem.reservationRequest.id,
        status: ReservationRequestStatus.PROCESSING,
        claimed_by: input.claimedWorkItem.claimedBy,
        claim_token: input.claimedWorkItem.claimToken,
      })
      .update({
        claim_expires_at: input.claimExpiresAt,
        last_heartbeat_at: input.heartbeatAt,
        updated_at: input.heartbeatAt,
      })
      .returning('id');

    return updatedRows.length === 1;
  }

  /**
   * Finds the oldest request that this worker is allowed to claim and locks it.
   *
   * Multiple worker processes may run this query at the same time. `forUpdate`
   * locks the chosen row, and `skipLocked` lets other workers move on to a
   * different row instead of waiting behind this transaction.
   */
  private async findNextClaimableReservationRequestRow(
    trx: Knex.Transaction,
    input: ClaimNextPendingReservationRequestInput,
  ): Promise<ReservationRequestRow | undefined> {
    const claimIntentTimestamp = input.claimedAt;
    return trx<ReservationRequestRow>('reservation_requests')
      .where((builder) => {
        builder
          .where((requestedBuilder) => {
            requestedBuilder
              .where({ status: ReservationRequestStatus.REQUESTED })
              .andWhere('transient_failure_count', '<', input.maxTransientFailures);
          })
          .orWhere((expiredProcessingBuilder) => {
            expiredProcessingBuilder
              .where({ status: ReservationRequestStatus.PROCESSING })
              .andWhere((claimExpiryBuilder) => {
                claimExpiryBuilder
                  .whereNull('claim_expires_at')
                  .orWhere('claim_expires_at', '<=', claimIntentTimestamp);
              });
          });
      })
      .orderBy('sequence', 'asc')
      .forUpdate()
      .skipLocked()
      .first();
  }

  /**
   * Moves a locked reservation request row into PROCESSING ownership.
   */
  private async claimReservationRequestRow(
    trx: Knex.Transaction,
    row: ReservationRequestRow,
    input: ClaimNextPendingReservationRequestInput,
    options: { readonly incrementLeaseTimeoutCount: boolean },
  ): Promise<ReservationRequestRow> {
    const updatedRows = await trx<ReservationRequestRow>('reservation_requests')
      .where({
        id: row.id,
      })
      .update({
        status: ReservationRequestStatus.PROCESSING,
        claimed_by: input.workerId,
        claim_token: input.claimToken,
        claimed_at: input.claimedAt,
        claim_expires_at: input.claimExpiresAt,
        last_heartbeat_at: input.claimedAt,
        ...(options.incrementLeaseTimeoutCount ? { lease_timeout_count: trx.raw('lease_timeout_count + 1') } : {}),
        updated_at: input.claimedAt,
      })
      .returning('*');

    return requireSingleRow(updatedRows, `Reservation request ${row.id} was not claimed`);
  }
}
