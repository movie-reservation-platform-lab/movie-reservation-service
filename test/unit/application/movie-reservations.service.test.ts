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
import { InMemoryMovieReservationRepository } from '../../../src/infrastructure/repositories/in-memory/in-memory-movie-reservation.repository';

describe('createActorContext', () => {
  it('keeps profile fields out of the application actor context', () => {
    const actor = createActorContext({
      userId: createUserId('user-ada'),
      username: 'ada',
      email: 'ada@example.test',
      movieProviderId: createMovieProviderId('provider-aurora'),
      roles: [UserRole.CUSTOMER],
      scopes: ['reservations:read'],
    });

    expect(actor).toEqual({
      userId: 'user-ada',
      movieProviderId: 'provider-aurora',
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
      movieProviderId: 'provider-aurora',
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('reservation-aurora-ada'),
    );

    expect(actualReservation).toMatchObject({
      id: 'reservation-aurora-ada',
      movieProviderId: 'provider-aurora',
      reservedByUserId: 'user-ada',
      seatIds: ['seat-aurora-1-a1', 'seat-aurora-1-a2'],
    });
  });

  it('does not expose another provider reservation', async () => {
    const service = createService();
    const actor = createCustomerActor({
      userId: 'user-ada',
      movieProviderId: 'provider-aurora',
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('reservation-riverton-linus'),
    );

    expect(actualReservation).toBeNull();
  });

  it('keeps customer access owner-only inside the same provider', async () => {
    const service = createService();
    const actor = createCustomerActor({
      userId: 'user-grace',
      movieProviderId: 'provider-aurora',
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('reservation-aurora-ada'),
    );

    expect(actualReservation).toBeNull();
  });

  it('allows a tenant admin placeholder override inside the same provider', async () => {
    const service = createService();
    const actor = createActorContext({
      userId: createUserId('user-aurora-admin'),
      username: 'aurora-admin',
      email: 'admin@aurora.example.test',
      movieProviderId: createMovieProviderId('provider-aurora'),
      roles: [UserRole.TENANT_ADMIN],
      scopes: [],
    });

    const actualReservation = await service.getReservation(
      actor,
      createReservationId('reservation-aurora-ada'),
    );

    expect(actualReservation).toMatchObject({
      id: 'reservation-aurora-ada',
      reservedByUserId: 'user-ada',
    });
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
    return createReservationRequestId('request-test');
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
