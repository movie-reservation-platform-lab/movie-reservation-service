import { describe, expect, it } from 'vitest';

import { createMovieProviderId } from '../../src/domain/movie-reservations/movie-provider-id';
import {
  createReservationRequest,
  failReservationRequest,
  startProcessingReservationRequest,
  confirmReservationRequest,
  rejectReservationRequest,
} from '../../src/domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../src/domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../src/domain/movie-reservations/reservation-request-status';
import { createScreeningId } from '../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../src/domain/movie-reservations/seat-id';
import { createUserId } from '../../src/domain/authentication/user-id';

describe('movie reservation domain ids', () => {
  it('creates provider, screening, seat, request, and user ids from non-empty strings', () => {
    expect(createMovieProviderId('provider-1')).toBe('provider-1');
    expect(createScreeningId('screening-1')).toBe('screening-1');
    expect(createSeatId('seat-a1')).toBe('seat-a1');
    expect(createReservationRequestId('request-1')).toBe('request-1');
    expect(createUserId('user-1')).toBe('user-1');
  });

  it('rejects empty ids at the domain boundary', () => {
    expect(() => createMovieProviderId('   ')).toThrow(
      'MovieProviderId cannot be empty',
    );
    expect(() => createSeatId('')).toThrow('SeatId cannot be empty');
  });
});

describe('ReservationRequest', () => {
  it('supports multiple selected seats from the start', () => {
    const request = createReservationRequest({
      id: createReservationRequestId('request-1'),
      movieProviderId: createMovieProviderId('provider-1'),
      screeningId: createScreeningId('screening-1'),
      seatIds: [createSeatId('seat-a1'), createSeatId('seat-a2')],
      requestedByUserId: createUserId('user-1'),
    });

    expect(request.status).toBe(ReservationRequestStatus.REQUESTED);
    expect(request.seatIds).toEqual(['seat-a1', 'seat-a2']);
  });

  it('rejects reservation requests without seats', () => {
    expect(() =>
      createReservationRequest({
        id: createReservationRequestId('request-1'),
        movieProviderId: createMovieProviderId('provider-1'),
        screeningId: createScreeningId('screening-1'),
        seatIds: [],
        requestedByUserId: createUserId('user-1'),
      }),
    ).toThrow('ReservationRequest must include at least one seat');
  });

  it('rejects duplicate selected seats', () => {
    expect(() =>
      createReservationRequest({
        id: createReservationRequestId('request-1'),
        movieProviderId: createMovieProviderId('provider-1'),
        screeningId: createScreeningId('screening-1'),
        seatIds: [createSeatId('seat-a1'), createSeatId('seat-a1')],
        requestedByUserId: createUserId('user-1'),
      }),
    ).toThrow('ReservationRequest cannot include duplicate seats');
  });

  it('allows the expected requested to processing to confirmed state transition', () => {
    const requested = createReservationRequest({
      id: createReservationRequestId('request-1'),
      movieProviderId: createMovieProviderId('provider-1'),
      screeningId: createScreeningId('screening-1'),
      seatIds: [createSeatId('seat-a1')],
      requestedByUserId: createUserId('user-1'),
    });

    const processing = startProcessingReservationRequest(requested);
    const confirmed = confirmReservationRequest(processing);

    expect(confirmed.status).toBe(ReservationRequestStatus.CONFIRMED);
  });

  it('allows processing requests to be rejected or failed', () => {
    const requested = createReservationRequest({
      id: createReservationRequestId('request-1'),
      movieProviderId: createMovieProviderId('provider-1'),
      screeningId: createScreeningId('screening-1'),
      seatIds: [createSeatId('seat-a1')],
      requestedByUserId: createUserId('user-1'),
    });
    const processing = startProcessingReservationRequest(requested);

    expect(rejectReservationRequest(processing).status).toBe(
      ReservationRequestStatus.REJECTED,
    );
    expect(failReservationRequest(processing).status).toBe(
      ReservationRequestStatus.FAILED,
    );
  });

  it('rejects invalid direct transitions from requested to confirmed', () => {
    const requested = createReservationRequest({
      id: createReservationRequestId('request-1'),
      movieProviderId: createMovieProviderId('provider-1'),
      screeningId: createScreeningId('screening-1'),
      seatIds: [createSeatId('seat-a1')],
      requestedByUserId: createUserId('user-1'),
    });

    expect(() => confirmReservationRequest(requested)).toThrow(
      'Cannot transition reservation request request-1 from REQUESTED to CONFIRMED',
    );
  });
});
