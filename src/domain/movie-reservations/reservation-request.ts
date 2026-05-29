import type { UserId } from '../authentication/user-id';
import type { MovieProviderId } from './movie-provider-id';
import type { ReservationRequestId } from './reservation-request-id';
import { ReservationRequestStatus } from './reservation-request-status';
import type { ScreeningId } from './screening-id';
import type { SeatId } from './seat-id';

/**
 * User request to reserve one or more seats for a screening.
 *
 * This is intentionally separate from `Reservation` so later workers can model
 * requested, processing, rejected, failed, and confirmed states explicitly.
 */
export interface ReservationRequest {
  readonly id: ReservationRequestId;
  readonly movieProviderId: MovieProviderId;
  readonly screeningId: ScreeningId;
  readonly seatIds: readonly SeatId[];
  readonly requestedByUserId: UserId;
  readonly status: ReservationRequestStatus;
}

/**
 * Input required to create a new reservation request in the requested state.
 */
export interface CreateReservationRequestInput {
  readonly id: ReservationRequestId;
  readonly movieProviderId: MovieProviderId;
  readonly screeningId: ScreeningId;
  readonly seatIds: readonly SeatId[];
  readonly requestedByUserId: UserId;
}

/**
 * Create a reservation request, enforce the first domain invariants
 *
 * a request must include at least one selected seat, and each selected
 * seat can appear only once.
 */
export function createReservationRequest(
  input: CreateReservationRequestInput,
): ReservationRequest {
  if (input.seatIds.length === 0) {
    throw new Error('ReservationRequest must include at least one seat');
  }

  if (new Set(input.seatIds).size !== input.seatIds.length) {
    throw new Error('ReservationRequest cannot include duplicate seats');
  }

  return {
    ...input,
    seatIds: [...input.seatIds],
    status: ReservationRequestStatus.REQUESTED,
  };
}
