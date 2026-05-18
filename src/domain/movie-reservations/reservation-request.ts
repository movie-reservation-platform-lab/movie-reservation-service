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
 * Creates a reservation request and enforces the first domain invariant: a
 * request must include at least one selected seat.
 */
export function createReservationRequest(
  input: CreateReservationRequestInput,
): ReservationRequest {
  if (input.seatIds.length === 0) {
    throw new Error('ReservationRequest must include at least one seat');
  }

  return {
    ...input,
    seatIds: [...input.seatIds],
    status: ReservationRequestStatus.REQUESTED,
  };
}

/**
 * Moves a requested reservation request into worker processing.
 */
export function startProcessingReservationRequest(
  request: ReservationRequest,
): ReservationRequest {
  return transitionReservationRequest(
    request,
    ReservationRequestStatus.PROCESSING,
    [ReservationRequestStatus.REQUESTED],
  );
}

/**
 * Confirms a processing reservation request.
 */
export function confirmReservationRequest(
  request: ReservationRequest,
): ReservationRequest {
  return transitionReservationRequest(
    request,
    ReservationRequestStatus.CONFIRMED,
    [ReservationRequestStatus.PROCESSING],
  );
}

/**
 * Rejects a processing reservation request because the requested seats cannot
 * be reserved.
 */
export function rejectReservationRequest(
  request: ReservationRequest,
): ReservationRequest {
  return transitionReservationRequest(
    request,
    ReservationRequestStatus.REJECTED,
    [ReservationRequestStatus.PROCESSING],
  );
}

/**
 * Marks a processing reservation request as failed because the processor hit an
 * unexpected technical or operational failure.
 */
export function failReservationRequest(
  request: ReservationRequest,
): ReservationRequest {
  return transitionReservationRequest(
    request,
    ReservationRequestStatus.FAILED,
    [ReservationRequestStatus.PROCESSING],
  );
}

function transitionReservationRequest(
  request: ReservationRequest,
  nextStatus: ReservationRequestStatus,
  allowedStatuses: readonly ReservationRequestStatus[],
): ReservationRequest {
  if (!allowedStatuses.includes(request.status)) {
    throw new Error(
      `Cannot transition reservation request ${request.id} from ${request.status} to ${nextStatus}`,
    );
  }

  return {
    ...request,
    status: nextStatus,
  };
}
