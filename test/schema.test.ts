import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { generatedGraphqlSchemaPath } from '../src/generated-graphql-schema';

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
    expect(schema).toContain('screenings(movieId: ID): [Screening!]!');
    expect(schema).toContain(
      'requestReservation(input: RequestReservationInput!): ReservationRequest!',
    );
    expect(schema).toContain(
      'reservationRequestById(id: ID!): ReservationRequest',
    );
    expect(schema).toContain('reservation(id: ID!): Reservation');
    expect(schema).toContain('type Movie');
    expect(schema).toContain('type Screening');
    expect(schema).toContain('type Seat');
    expect(schema).toContain('type ReservationRequest');
    expect(schema).toContain('type Reservation');
    expect(schema).toContain('enum ReservationRequestStatus');
    expect(schema).toContain('input RequestReservationInput');
    expect(schema).toMatch(
      /input RequestReservationInput \{\n\s+screeningId: ID!\n\s+seatIds: \[ID!\]!\n\}/,
    );
  });
});
