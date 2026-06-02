import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { generatedGraphqlSchemaPath } from '../../../src/generated-graphql-schema';

describe('generated GraphQL schema', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ authMode: 'local-fixed-user' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('contains the first movie reservation auth contract', () => {
    const schema = readFileSync(generatedGraphqlSchemaPath, 'utf8');

    expect(schema).toContain('type Query');
    expect(schema).toContain('me: AuthenticatedUser!');
    expect(schema).toContain('type AuthenticatedUser');
    expect(schema).not.toContain('booking(id: ID!): Booking');
    expect(schema).not.toContain('bookings: [Booking!]!');
    expect(schema).not.toContain('RequestBookingSyncInput');
  });

  it('contains the movie reservation polling API contract', () => {
    const schema = readFileSync(generatedGraphqlSchemaPath, 'utf8');

    expect(schema).toContain('movies: [Movie!]!');
    expect(schema).toMatch(
      /screenings\(\s+"""Optional movie id used to show screenings for one movie\."""\s+movieId: ID\s+\): \[Screening!\]!/,
    );
    expect(schema).toMatch(
      /requestReservation\(\s+"""[\s\S]*?Tenant scope comes from authentication, not from this input\.[\s\S]*?"""\s+input: RequestReservationInput!\s+\): ReservationRequest!/,
    );
    expect(schema).toMatch(
      /reservationRequestStatus\(\s+"""Reservation request id returned by requestReservation\."""\s+id: ID!\s+\): ReservationRequest/,
    );
    expect(schema).toMatch(
      /reservationResult\(\s+"""[\s\S]*?Returns null until the request is confirmed\.[\s\S]*?"""\s+requestId: ID!\s+\): Reservation/,
    );
    expect(schema).not.toContain('reservationRequestById(id: ID!): ReservationRequest');
    expect(schema).not.toContain('confirmedReservation(id: ID!): Reservation');
    expect(schema).toContain('Polls the status of a reservation request created by requestReservation.');
    expect(schema).toContain('Intent-driven command to reserve seats.');
    expect(schema).toContain('type Movie');
    expect(schema).toContain('type Screening');
    expect(schema).toContain('type Seat');
    expect(schema).toContain('type ReservationRequest');
    expect(schema).toContain('type Reservation');
    expect(schema).toContain('enum ReservationRequestStatus');
    expect(schema).toContain('input RequestReservationInput');
    expect(schema).toMatch(
      /input RequestReservationInput \{\s+"""Screening the user wants to reserve seats for\."""\s+screeningId: ID!\s+"""[\s\S]*?The whole request is rejected if any requested seat conflicts during processing\.[\s\S]*?"""\s+seatIds: \[ID!\]!\s+\}/,
    );
  });
});
