import { describe, expect, it } from 'vitest';

import { createActorContext } from '../../../src/application/authentication/actor-context';
import { AuthorizationService } from '../../../src/application/authorization/authorization.service';
import { MovieReservationsService } from '../../../src/application/movie-reservations/movie-reservations.service';
import type { ReservationRequestIdGenerator } from '../../../src/application/movie-reservations/ports/reservation-request-id-generator';
import { createUserId } from '../../../src/domain/authentication/user-id';
import { UserRole } from '../../../src/domain/authentication/user-role';
import { createMovieProviderId } from '../../../src/domain/movie-reservations/movie-provider-id';
import { createReservationId } from '../../../src/domain/movie-reservations/reservation-id';
import { createReservationRequestId } from '../../../src/domain/movie-reservations/reservation-request-id';
import { createScreeningId } from '../../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../../src/domain/movie-reservations/seat-id';
import { MOVIE_RESERVATION_DEMO_IDS } from '../../../src/infrastructure/fixtures/movie-reservations/movie-reservation-demo-data';
import { InMemoryMovieReservationRepository } from '../../../src/infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';

describe('createActorContext', () => {
  it('keeps profile fields out of the application actor context', () => {
    const actor = createActorContext({
      userId: createUserId('user-ada'),
      username: 'ada',
      email: 'ada@example.test',
      movieProviderId: createMovieProviderId(
        '11111111-1111-4111-8111-111111111111',
      ),
      roles: [UserRole.CUSTOMER],
      scopes: ['reservations:read'],
    });

    expect(actor).toEqual({
      userId: 'user-ada',
      movieProviderId: '11111111-1111-4111-8111-111111111111',
      roles: ['CUSTOMER'],
      scopes: ['reservations:read'],
    });
    expect(actor).not.toHaveProperty('username');
    expect(actor).not.toHaveProperty('email');
  });
});

describe('MovieReservationsService authorization behavior', () => {
  it('returns a reservation to its owner in the same movie provider', async () => {
    const service = createService();
    const actor = createCustomerActor({
      userId: 'user-ada',
      movieProviderId: '11111111-1111-4111-8111-111111111111',
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('88888888-8888-4888-8888-888888888881'),
    );

    expect(actualReservation).toMatchObject({
      id: '88888888-8888-4888-8888-888888888881',
      movieProviderId: '11111111-1111-4111-8111-111111111111',
      reservedByUserId: 'user-ada',
      seatIds: [
        '66666666-6666-4666-8666-666666666661',
        '66666666-6666-4666-8666-666666666662',
      ],
    });
  });

  it('does not expose another provider reservation', async () => {
    const service = createService();
    const actor = createCustomerActor({
      userId: 'user-ada',
      movieProviderId: '11111111-1111-4111-8111-111111111111',
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('88888888-8888-4888-8888-888888888882'),
    );

    expect(actualReservation).toBeNull();
  });

  it('keeps customer access owner-only inside the same provider', async () => {
    const service = createService();
    const actor = createCustomerActor({
      userId: 'user-grace',
      movieProviderId: '11111111-1111-4111-8111-111111111111',
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('88888888-8888-4888-8888-888888888881'),
    );

    expect(actualReservation).toBeNull();
  });

  it('allows a tenant admin placeholder override inside the same provider', async () => {
    const service = createService();
    const actor = createActorContext({
      userId: createUserId('user-aurora-admin'),
      username: 'aurora-admin',
      email: 'admin@aurora.example.test',
      movieProviderId: createMovieProviderId(
        '11111111-1111-4111-8111-111111111111',
      ),
      roles: [UserRole.TENANT_ADMIN],
      scopes: [],
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('88888888-8888-4888-8888-888888888881'),
    );

    expect(actualReservation).toMatchObject({
      id: '88888888-8888-4888-8888-888888888881',
      reservedByUserId: 'user-ada',
    });
  });
});

describe('MovieReservationsService reservation requests', () => {
  it('rejects a requested seat that does not belong to the screening auditorium', async () => {
    const service = createService();
    const actor = createCustomerActor({
      userId: 'user-ada',
      movieProviderId: MOVIE_RESERVATION_DEMO_IDS.providers.aurora,
    });
    const screeningId = createScreeningId(
      MOVIE_RESERVATION_DEMO_IDS.screenings.auroraTypeSafeMatineeMorning,
    );
    const rivertonSeatId = createSeatId(
      MOVIE_RESERVATION_DEMO_IDS.seats.rivertonB3,
    );

    await expect(
      service.requestReservation(actor, {
        screeningId,
        seatIds: [rivertonSeatId],
      }),
    ).rejects.toThrow(
      `Seat ${rivertonSeatId} is not available for screening ${screeningId}`,
    );
  });
});

function createService(): MovieReservationsService {
  return new MovieReservationsService(
    InMemoryMovieReservationRepository.withSeedData(),
    new AuthorizationService(),
    new StubReservationRequestIdGenerator(),
  );
}

class StubReservationRequestIdGenerator implements ReservationRequestIdGenerator {
  generateReservationRequestId() {
    return createReservationRequestId('99999999-9999-4999-8999-999999999924');
  }
}

function createCustomerActor(input: {
  readonly userId: string;
  readonly movieProviderId: string;
}) {
  return createActorContext({
    userId: createUserId(input.userId),
    username: input.userId,
    email: `${input.userId}@example.test`,
    movieProviderId: createMovieProviderId(input.movieProviderId),
    roles: [UserRole.CUSTOMER],
    scopes: [],
  });
}
