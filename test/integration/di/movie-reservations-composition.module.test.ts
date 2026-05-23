import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AuthenticationService } from '../../../src/application/authentication/authentication.service';
import { MovieReservationsService } from '../../../src/application/movie-reservations/movie-reservations.service';
import type { MovieReservationRepository } from '../../../src/application/movie-reservations/ports/movie-reservation-repository';
import { createMovieProviderId } from '../../../src/domain/movie-reservations/movie-provider-id';
import { MOVIE_RESERVATION_REPOSITORY } from '../../../src/di/movie-reservations/movie-reservation.tokens';
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
        createMovieProviderId('provider-aurora'),
      ),
    ).resolves.toHaveLength(2);
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
      movieProviderId: 'provider-aurora',
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
          movie_provider_id: 'provider-riverton',
          realm_access: { roles: ['CUSTOMER'] },
          scope: 'reservations:read',
        }),
      ),
    ).resolves.toMatchObject({
      userId: 'user-grace',
      username: 'grace',
      movieProviderId: 'provider-riverton',
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
