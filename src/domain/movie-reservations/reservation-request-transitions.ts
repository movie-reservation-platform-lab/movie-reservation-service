import type { ReservationRequest } from './reservation-request';
import { ReservationRequestStatus } from './reservation-request-status';

/**
 * Move a requested reservation request into processing.
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
 * Confirm a processing reservation request.
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
 * Reject a processing reservation request because the requested seats cannot
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
 * Mark a processing reservation request as failed because the reservation
 * workflow could not complete.
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

/**
 * State transitioning helper
 *
 * @param request
 * @param nextStatus
 * @param allowedStatuses
 */
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
