import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import type * as GraphqlModule from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';

// Vite would resolve `import 'graphql'` to its ESM build, while Nest require()s the
// CommonJS build; graphql rejects schema objects from the other copy. Load the same copy.
const { printSchema } = createRequire(join(process.cwd(), 'package.json'))('graphql') as typeof GraphqlModule;

describe('generated GraphQL schema', () => {
  let app: INestApplication;
  let schema: string;

  beforeAll(async () => {
    app = await createApp({ authMode: 'local-fixed-user' });
    await app.init();
    // Print the schema this app built (sortSchema already applied) instead of reading
    // schema.gql, which every concurrently starting app rewrites in place.
    schema = printSchema(app.get(GraphQLSchemaHost).schema);
  });

  afterAll(async () => {
    await app.close();
  });

  it('contains the first movie reservation auth contract', () => {
    expect(schema).toContain('type Query');
    expect(schema).toContain('me: AuthenticatedUser!');
    expect(schema).toContain('type AuthenticatedUser');
    expect(schema).not.toContain('booking(id: ID!): Booking');
    expect(schema).not.toContain('bookings: [Booking!]!');
    expect(schema).not.toContain('RequestBookingSyncInput');
  });

  it('contains the movie reservation polling API contract', () => {
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
