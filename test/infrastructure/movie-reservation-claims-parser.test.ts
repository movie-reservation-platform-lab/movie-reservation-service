import { describe, expect, it } from 'vitest';

import type { JwtClaims } from '../../src/application/authentication/token-validation-client';
import { parseMovieReservationClaims } from '../../src/infrastructure/authentication/movie-reservation-claims-parser';

describe('parseMovieReservationClaims', () => {
  it('maps required identity claims into an authenticated user', () => {
    const user = parseMovieReservationClaims(
      validClaims({
        sub: 'user-ada',
        preferred_username: 'ada',
        email: 'ada@aurora.example.test',
        movie_provider_id: 'provider-aurora',
      }),
    );

    expect(user).toEqual({
      userId: 'user-ada',
      username: 'ada',
      email: 'ada@aurora.example.test',
      movieProviderId: 'provider-aurora',
      roles: [],
      scopes: [],
    });
  });

  it('falls back from preferred username to name and then user id', () => {
    expect(
      parseMovieReservationClaims(
        validClaims({
          sub: 'user-grace',
          name: 'Grace Hopper',
        }),
      ).username,
    ).toBe('Grace Hopper');

    expect(
      parseMovieReservationClaims(
        validClaims({
          sub: 'user-katherine',
        }),
      ).username,
    ).toBe('user-katherine');
  });

  it('splits space-delimited scopes and ignores empty entries', () => {
    const user = parseMovieReservationClaims(
      validClaims({
        scope: ' reservations:read  reservations:write ',
      }),
    );

    expect(user.scopes).toEqual(['reservations:read', 'reservations:write']);
  });

  it('returns no scopes when the scope claim is absent or not a string', () => {
    expect(
      parseMovieReservationClaims(
        validClaims({
          scope: undefined,
        }),
      ).scopes,
    ).toEqual([]);

    expect(
      parseMovieReservationClaims(
        validClaims({
          scope: ['reservations:read'],
        }),
      ).scopes,
    ).toEqual([]);
  });

  it('keeps supported roles from realm and resource claims', () => {
    const user = parseMovieReservationClaims(
      validClaims({
        realm_access: { roles: ['CUSTOMER', 'UNKNOWN', 123] },
        resource_access: {
          reservation_api: { roles: ['TENANT_ADMIN'] },
          account: { roles: ['SYSTEM', false] },
          malformed: { roles: 'CUSTOMER' },
        },
      }),
    );

    expect(user.roles).toEqual(['CUSTOMER', 'TENANT_ADMIN', 'SYSTEM']);
  });

  it('returns no roles when role containers are missing or malformed', () => {
    const user = parseMovieReservationClaims(
      validClaims({
        realm_access: null,
        resource_access: {
          reservation_api: null,
          account: { permissions: ['CUSTOMER'] },
        },
      }),
    );

    expect(user.roles).toEqual([]);
  });

  it('rejects missing or blank required claims', () => {
    expect(() =>
      parseMovieReservationClaims(
        validClaims({
          sub: '   ',
        }),
      ),
    ).toThrow('Invalid token claims');

    expect(() =>
      parseMovieReservationClaims(
        validClaims({
          movie_provider_id: undefined,
        }),
      ),
    ).toThrow('Invalid token claims');
  });
});

function validClaims(overrides: JwtClaims = {}): JwtClaims {
  return {
    sub: 'user-ada',
    movie_provider_id: 'provider-aurora',
    ...overrides,
  };
}
