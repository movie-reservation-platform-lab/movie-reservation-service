import { describe, expect, it } from 'vitest';

import { createMovieProviderId } from '../../../src/domain/movie-reservations/movie-provider-id';
import { createReservation } from '../../../src/domain/movie-reservations/reservation';
import { createReservationId } from '../../../src/domain/movie-reservations/reservation-id';
import { createReservationRequest } from '../../../src/domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../../src/domain/movie-reservations/reservation-request-id';
import { createReservationRequestSequence } from '../../../src/domain/movie-reservations/reservation-request-sequence';
import { ReservationRequestStatus } from '../../../src/domain/movie-reservations/reservation-request-status';
import {
  confirmReservationRequest,
  failReservationRequest,
  rejectReservationRequest,
  startProcessingReservationRequest,
} from '../../../src/domain/movie-reservations/reservation-request-transitions';
import { createScreeningId } from '../../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../../src/domain/movie-reservations/seat-id';
import { createUserId } from '../../../src/domain/authentication/user-id';

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

describe('ReservationRequestSequence', () => {
  it('creates a branded positive safe integer sequence', () => {
    expect(createReservationRequestSequence(1)).toBe(1);
    expect(createReservationRequestSequence(42)).toBe(42);
  });

  it('rejects invalid sequence values', () => {
    expect(() => createReservationRequestSequence(0)).toThrow(
      'ReservationRequestSequence must be a positive safe integer',
    );
    expect(() => createReservationRequestSequence(1.5)).toThrow(
      'ReservationRequestSequence must be a positive safe integer',
    );
  });
});

describe('Reservation', () => {
  it('creates a confirmed reservation with copied seat ids', () => {
    const inputSeatIds = [createSeatId('seat-a1'), createSeatId('seat-a2')];

    const reservation = createReservation({
      id: createReservationId('reservation-1'),
      movieProviderId: createMovieProviderId('provider-1'),
      reservationRequestId: createReservationRequestId('request-1'),
      screeningId: createScreeningId('screening-1'),
      seatIds: inputSeatIds,
      reservedByUserId: createUserId('user-1'),
      confirmedAt: '2026-06-01T09:00:00.000Z',
    });

    expect(reservation).toMatchObject({
      id: 'reservation-1',
      reservationRequestId: 'request-1',
      seatIds: ['seat-a1', 'seat-a2'],
    });
    expect(reservation.seatIds).not.toBe(inputSeatIds);
  });

  it('rejects confirmed reservations without seats', () => {
    expect(() =>
      createReservation({
        id: createReservationId('reservation-1'),
        movieProviderId: createMovieProviderId('provider-1'),
        reservationRequestId: createReservationRequestId('request-1'),
        screeningId: createScreeningId('screening-1'),
        seatIds: [],
        reservedByUserId: createUserId('user-1'),
        confirmedAt: '2026-06-01T09:00:00.000Z',
      }),
    ).toThrow('Reservation must include at least one seat');
  });

  it('rejects duplicate seats in confirmed reservations', () => {
    expect(() =>
      createReservation({
        id: createReservationId('reservation-1'),
        movieProviderId: createMovieProviderId('provider-1'),
        reservationRequestId: createReservationRequestId('request-1'),
        screeningId: createScreeningId('screening-1'),
        seatIds: [createSeatId('seat-a1'), createSeatId('seat-a1')],
        reservedByUserId: createUserId('user-1'),
        confirmedAt: '2026-06-01T09:00:00.000Z',
      }),
    ).toThrow('Reservation cannot include duplicate seats');
  });
});
