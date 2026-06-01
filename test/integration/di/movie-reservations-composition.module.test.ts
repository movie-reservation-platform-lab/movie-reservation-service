import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { createActorContext } from '../../../src/application/authentication/actor-context';
import { AuthenticationService } from '../../../src/application/authentication/authentication.service';
import { MovieReservationsService } from '../../../src/application/movie-reservations/movie-reservations.service';
import type { MovieReservationRepository } from '../../../src/application/movie-reservations/ports/movie-reservation-repository';
import type { ReservationRequestProcessor } from '../../../src/application/movie-reservations/ports/reservation-request-processor';
import { createUserId } from '../../../src/domain/authentication/user-id';
import { UserRole } from '../../../src/domain/authentication/user-role';
import { createMovieProviderId } from '../../../src/domain/movie-reservations/movie-provider-id';
import { ReservationRequestStatus } from '../../../src/domain/movie-reservations/reservation-request-status';
import { createScreeningId } from '../../../src/domain/movie-reservations/screening-id';
import { createSeatId } from '../../../src/domain/movie-reservations/seat-id';
import {
  MOVIE_RESERVATION_REPOSITORY,
  RESERVATION_REQUEST_PROCESSOR,
} from '../../../src/di/movie-reservations/movie-reservation.tokens';
import { MovieReservationsCompositionModule } from '../../../src/di/movie-reservations/movie-reservations-composition.module';

describe('MovieReservationsCompositionModule', () => {
  it('resolves the application services and repository token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MovieReservationsCompositionModule.forRoot({
          authMode: 'local-fixed-user',
        }),
      ],
    }).compile();

    const authenticationService = moduleRef.get(AuthenticationService);
    const reservationsService = moduleRef.get(MovieReservationsService);
    const repository = moduleRef.get<MovieReservationRepository>(
      MOVIE_RESERVATION_REPOSITORY,
    );

    expect(authenticationService).toBeInstanceOf(AuthenticationService);
    expect(reservationsService).toBeInstanceOf(MovieReservationsService);
    await expect(
      repository.findMoviesByProviderId(
        createMovieProviderId('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toHaveLength(2);
  });

  it('wires the processor over the same in-memory store as the application service', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MovieReservationsCompositionModule.forRoot({
          authMode: 'local-fixed-user',
        }),
      ],
    }).compile();
    const reservationsService = moduleRef.get(MovieReservationsService);
    const processor = moduleRef.get<ReservationRequestProcessor>(
      RESERVATION_REQUEST_PROCESSOR,
    );
    const actor = createActorContext({
      userId: createUserId('local-dev-user'),
      username: 'local-dev-admin',
      email: 'local-dev@example.test',
      movieProviderId: createMovieProviderId(
        '11111111-1111-4111-8111-111111111111',
      ),
      roles: [UserRole.TENANT_ADMIN],
      scopes: ['reservations:read:tenant'],
    });

    const reservationRequest = await reservationsService.requestReservation(
      actor,
      {
        screeningId: createScreeningId('55555555-5555-4555-8555-555555555551'),
        seatIds: [createSeatId('66666666-6666-4666-8666-666666666663')],
      },
    );

    expect(reservationRequest.status).toBe(ReservationRequestStatus.REQUESTED);

    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'confirmed',
      reservationRequest: {
        id: reservationRequest.id,
        status: ReservationRequestStatus.CONFIRMED,
      },
    });
    await expect(
      reservationsService.getReservationRequest(actor, reservationRequest.id),
    ).resolves.toMatchObject({
      id: reservationRequest.id,
      status: ReservationRequestStatus.CONFIRMED,
    });
  });

  it('wires local-fixed-user auth as a convenient development identity', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MovieReservationsCompositionModule.forRoot({
          authMode: 'local-fixed-user',
        }),
      ],
    }).compile();

    const authenticationService = moduleRef.get(AuthenticationService);

    await expect(
      authenticationService.authenticateJwtToken(undefined),
    ).resolves.toMatchObject({
      userId: 'local-dev-user',
      username: 'local-dev-admin',
      movieProviderId: '11111111-1111-4111-8111-111111111111',
      roles: ['TENANT_ADMIN'],
    });
  });

  it('wires local-jwt auth for claim-driven tests', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MovieReservationsCompositionModule.forRoot({
          authMode: 'local-jwt',
        }),
      ],
    }).compile();

    const authenticationService = moduleRef.get(AuthenticationService);

    await expect(
      authenticationService.authenticateJwtToken(
        createUnsignedJwt({
          sub: 'user-grace',
          preferred_username: 'grace',
          email: 'grace@example.test',
          movie_provider_id: '22222222-2222-4222-8222-222222222222',
          realm_access: { roles: ['CUSTOMER'] },
          scope: 'reservations:read',
        }),
      ),
    ).resolves.toMatchObject({
      userId: 'user-grace',
      username: 'grace',
      movieProviderId: '22222222-2222-4222-8222-222222222222',
      roles: ['CUSTOMER'],
      scopes: ['reservations:read'],
    });
  });

  it('keeps oidc auth explicit until a production validator exists', () => {
    expect(() =>
      MovieReservationsCompositionModule.forRoot({
        authMode: 'oidc',
      }),
    ).toThrow('OIDC token validation is not implemented yet');
  });
});

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'none', typ: 'JWT' };
  return [
    encodeBase64UrlJson(header),
    encodeBase64UrlJson(payload),
    'local-signature',
  ].join('.');
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
