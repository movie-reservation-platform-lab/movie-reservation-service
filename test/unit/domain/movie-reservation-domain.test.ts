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
  it('creates service-owned ids from UUID strings and user ids from non-empty strings', () => {
    expect(createMovieProviderId('99999999-9999-4999-8999-999999999901')).toBe('99999999-9999-4999-8999-999999999901');
    expect(createScreeningId('99999999-9999-4999-8999-999999999902')).toBe('99999999-9999-4999-8999-999999999902');
    expect(createSeatId('99999999-9999-4999-8999-999999999903')).toBe('99999999-9999-4999-8999-999999999903');
    expect(createReservationRequestId('99999999-9999-4999-8999-999999999906')).toBe(
      '99999999-9999-4999-8999-999999999906',
    );
    expect(createUserId('user-1')).toBe('user-1');
  });

  it('rejects non-UUID service-owned ids at the domain boundary', () => {
    expect(() => createMovieProviderId('provider-1')).toThrow('MovieProviderId must be a UUID');
    expect(() => createSeatId('')).toThrow('SeatId must be a UUID');
    expect(() => createUserId('   ')).toThrow('UserId cannot be empty');
  });
});

describe('ReservationRequest', () => {
  it('supports multiple selected seats from the start', () => {
    const request = createReservationRequest({
      id: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
      movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
      screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
      seatIds: [
        createSeatId('99999999-9999-4999-8999-999999999903'),
        createSeatId('99999999-9999-4999-8999-999999999904'),
      ],
      requestedByUserId: createUserId('user-1'),
    });

    expect(request.status).toBe(ReservationRequestStatus.REQUESTED);
    expect(request.seatIds).toEqual(['99999999-9999-4999-8999-999999999903', '99999999-9999-4999-8999-999999999904']);
  });

  it('rejects reservation requests without seats', () => {
    expect(() =>
      createReservationRequest({
        id: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
        movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
        screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
        seatIds: [],
        requestedByUserId: createUserId('user-1'),
      }),
    ).toThrow('ReservationRequest must include at least one seat');
  });

  it('rejects duplicate selected seats', () => {
    expect(() =>
      createReservationRequest({
        id: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
        movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
        screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
        seatIds: [
          createSeatId('99999999-9999-4999-8999-999999999903'),
          createSeatId('99999999-9999-4999-8999-999999999903'),
        ],
        requestedByUserId: createUserId('user-1'),
      }),
    ).toThrow('ReservationRequest cannot include duplicate seats');
  });

  it('allows the expected requested to processing to confirmed state transition', () => {
    const requested = createReservationRequest({
      id: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
      movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
      screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
      seatIds: [createSeatId('99999999-9999-4999-8999-999999999903')],
      requestedByUserId: createUserId('user-1'),
    });

    const processing = startProcessingReservationRequest(requested);
    const confirmed = confirmReservationRequest(processing);

    expect(confirmed.status).toBe(ReservationRequestStatus.CONFIRMED);
  });

  it('allows processing requests to be rejected or failed', () => {
    const requested = createReservationRequest({
      id: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
      movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
      screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
      seatIds: [createSeatId('99999999-9999-4999-8999-999999999903')],
      requestedByUserId: createUserId('user-1'),
    });
    const processing = startProcessingReservationRequest(requested);

    expect(rejectReservationRequest(processing).status).toBe(ReservationRequestStatus.REJECTED);
    expect(failReservationRequest(processing).status).toBe(ReservationRequestStatus.FAILED);
  });

  it('rejects invalid direct transitions from requested to confirmed', () => {
    const requested = createReservationRequest({
      id: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
      movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
      screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
      seatIds: [createSeatId('99999999-9999-4999-8999-999999999903')],
      requestedByUserId: createUserId('user-1'),
    });

    expect(() => confirmReservationRequest(requested)).toThrow(
      'Cannot transition reservation request 99999999-9999-4999-8999-999999999906 from REQUESTED to CONFIRMED',
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
    const inputSeatIds = [
      createSeatId('99999999-9999-4999-8999-999999999903'),
      createSeatId('99999999-9999-4999-8999-999999999904'),
    ];

    const reservation = createReservation({
      id: createReservationId('99999999-9999-4999-8999-999999999907'),
      movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
      reservationRequestId: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
      screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
      seatIds: inputSeatIds,
      reservedByUserId: createUserId('user-1'),
      confirmedAt: '2026-06-01T09:00:00.000Z',
    });

    expect(reservation).toMatchObject({
      id: '99999999-9999-4999-8999-999999999907',
      reservationRequestId: '99999999-9999-4999-8999-999999999906',
      seatIds: ['99999999-9999-4999-8999-999999999903', '99999999-9999-4999-8999-999999999904'],
    });
    expect(reservation.seatIds).not.toBe(inputSeatIds);
  });

  it('rejects confirmed reservations without seats', () => {
    expect(() =>
      createReservation({
        id: createReservationId('99999999-9999-4999-8999-999999999907'),
        movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
        reservationRequestId: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
        screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
        seatIds: [],
        reservedByUserId: createUserId('user-1'),
        confirmedAt: '2026-06-01T09:00:00.000Z',
      }),
    ).toThrow('Reservation must include at least one seat');
  });

  it('rejects duplicate seats in confirmed reservations', () => {
    expect(() =>
      createReservation({
        id: createReservationId('99999999-9999-4999-8999-999999999907'),
        movieProviderId: createMovieProviderId('99999999-9999-4999-8999-999999999901'),
        reservationRequestId: createReservationRequestId('99999999-9999-4999-8999-999999999906'),
        screeningId: createScreeningId('99999999-9999-4999-8999-999999999902'),
        seatIds: [
          createSeatId('99999999-9999-4999-8999-999999999903'),
          createSeatId('99999999-9999-4999-8999-999999999903'),
        ],
        reservedByUserId: createUserId('user-1'),
        confirmedAt: '2026-06-01T09:00:00.000Z',
      }),
    ).toThrow('Reservation cannot include duplicate seats');
  });
});
