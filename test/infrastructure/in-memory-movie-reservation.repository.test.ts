import { describe, expect, it } from 'vitest';

import { createUserId } from '../../src/domain/authentication/user-id';
import { createMovieId } from '../../src/domain/movie-reservations/movie-id';
import { createMovieProviderId } from '../../src/domain/movie-reservations/movie-provider-id';
import { createReservationRequest } from '../../src/domain/movie-reservations/reservation-request';
import { createReservationRequestId } from '../../src/domain/movie-reservations/reservation-request-id';
import { ReservationRequestStatus } from '../../src/domain/movie-reservations/reservation-request-status';
import { createReservationId } from '../../src/domain/movie-reservations/reservation-id';
import { createScreeningId } from '../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../src/domain/movie-reservations/seat-id';
import { InMemoryMovieReservationRepository } from '../../src/infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';

describe('InMemoryMovieReservationRepository', () => {
  it('seeds movies for at least two movie providers', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findMovieProviderById(
        createMovieProviderId('provider-aurora'),
      ),
    ).resolves.toMatchObject({ name: 'Aurora Cinema Group' });

    const auroraMovies = await repository.findMoviesByProviderId(
      createMovieProviderId('provider-aurora'),
    );
    const rivertonMovies = await repository.findMoviesByProviderId(
      createMovieProviderId('provider-riverton'),
    );

    expect(auroraMovies).toHaveLength(2);
    expect(rivertonMovies).toHaveLength(1);
    expect(auroraMovies).not.toEqual(rivertonMovies);
  });

  it('scopes movie lookup to the requested provider', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findMovieById(
        createMovieProviderId('provider-aurora'),
        createMovieId('movie-riverton-1'),
      ),
    ).resolves.toBeNull();
  });

  it('seeds screenings and seats for provider-scoped catalog flows', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    const auroraScreenings = await repository.findScreeningsByProviderId(
      createMovieProviderId('provider-aurora'),
    );
    const auroraSeats = await repository.findSeatsByScreeningId(
      createMovieProviderId('provider-aurora'),
      createScreeningId('screening-aurora-1'),
    );

    expect(auroraScreenings).toHaveLength(2);
    expect(auroraSeats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'seat-aurora-1-a1' }),
        expect.objectContaining({ id: 'seat-aurora-1-a2' }),
      ]),
    );
  });

  it('seeds reservation request state with multiple selected seats', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.findReservationRequestById(
        createReservationRequestId('request-aurora-ada'),
      ),
    ).resolves.toMatchObject({
      movieProviderId: 'provider-aurora',
      seatIds: ['seat-aurora-1-a1', 'seat-aurora-1-a2'],
      status: ReservationRequestStatus.CONFIRMED,
    });
  });

  it('rejects saving a reservation request with an id that already exists', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();

    await expect(
      repository.saveReservationRequest(
        createReservationRequest({
          id: createReservationRequestId('request-aurora-ada'),
          movieProviderId: createMovieProviderId('provider-aurora'),
          screeningId: createScreeningId('screening-aurora-1'),
          seatIds: [createSeatId('seat-aurora-1-a3')],
          requestedByUserId: createUserId('local-dev-user'),
        }),
      ),
    ).rejects.toThrow('Reservation request request-aurora-ada already exists');
  });

  it('returns reservations by id so application authorization can make the access decision', async () => {
    const repository = InMemoryMovieReservationRepository.withSeedData();
    const reservationId = createReservationId('reservation-aurora-ada');

    await expect(
      repository.findReservationById(reservationId),
    ).resolves.toMatchObject({
      movieProviderId: 'provider-aurora',
      reservedByUserId: 'user-ada',
    });
  });
});
