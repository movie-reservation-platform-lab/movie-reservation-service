import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { generatedGraphqlSchemaPath } from '../src/generated-graphql-schema';

describe('generated GraphQL schema', () => {
  it('contains the first movie reservation auth contract', () => {
    const schema = readFileSync(generatedGraphqlSchemaPath, 'utf8');

    expect(schema).toContain('type Query');
    expect(schema).toContain('me: AuthenticatedUser!');
    expect(schema).toContain('type AuthenticatedUser');
    expect(schema).not.toContain('booking(id: ID!): Booking');
    expect(schema).not.toContain('bookings: [Booking!]!');
    expect(schema).not.toContain('RequestBookingSyncInput');
  });
});
