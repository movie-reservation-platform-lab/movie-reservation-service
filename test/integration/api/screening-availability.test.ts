import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app';
import type { ReservationRequestProcessor } from '../../../src/application/movie-reservations/ports/reservation-request-processor';
import { RESERVATION_REQUEST_PROCESSOR } from '../../../src/di/movie-reservations/movie-reservation.tokens';
import { MOVIE_RESERVATION_DEMO_IDS as ids } from '../../../src/infrastructure/fixtures/movie-reservations/movie-reservation-demo-data';

describe('screening availability through authenticated GraphQL', () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await createApp({ authMode: 'local-fixed-user', reservationWorkerMode: 'disabled' });
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
  });

  async function read(screeningId: string) {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: 'query($id: ID!) { screeningAvailability(screeningId: $id) { screeningId seats { seatId available } } }',
        variables: { id: screeningId },
      });
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    return z
      .object({
        data: z.object({
          screeningAvailability: z
            .object({
              screeningId: z.string(),
              seats: z.array(z.object({ seatId: z.string(), available: z.boolean() })),
            })
            .nullable(),
        }),
      })
      .parse(response.body).data.screeningAvailability;
  }

  it('reconstructs occupancy after confirmation and still rejects a competing request', async () => {
    const screeningId = ids.screenings.auroraTypeSafeMatineeMorning;
    const seatId = ids.seats.auroraA3;
    expect((await read(screeningId))?.seats).toContainEqual({ seatId, available: true });
    const submit = () =>
      request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: 'mutation($input: RequestReservationInput!) { requestReservation(input: $input) { id status } }',
          variables: { input: { screeningId, seatIds: [seatId] } },
        });
    const pending = await submit();
    expect(pending.body.errors).toBeUndefined();
    expect((await read(screeningId))?.seats).toContainEqual({ seatId, available: true });
    const competing = await submit();
    expect(competing.body.errors).toBeUndefined();
    const processor = app.get<ReservationRequestProcessor>(RESERVATION_REQUEST_PROCESSOR);
    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({ outcome: 'confirmed' });
    expect((await read(screeningId))?.seats).toContainEqual({ seatId, available: false });
    await expect(processor.processNextPendingRequest()).resolves.toMatchObject({
      outcome: 'rejected',
      reason: 'seat-conflict',
    });
    // A fresh request has no reliance on the browser's previous mutation result.
    expect((await read(screeningId))?.seats).toContainEqual({ seatId, available: false });
    expect((await read(ids.screenings.auroraStarWarsNewHopeAfternoon))?.seats).toContainEqual({
      seatId,
      available: true,
    });
  });

  it('does not disclose foreign or missing screenings', async () => {
    expect(await read(ids.screenings.rivertonLastDeploymentMorning)).toBeNull();
    expect(await read('99999999-9999-4999-8999-999999999999')).toBeNull();
  });

  it('retains the existing authentication middleware for the new query', async () => {
    const authenticatedApp = await createApp({ authMode: 'local-jwt', reservationWorkerMode: 'disabled' });
    try {
      await authenticatedApp.init();
      const response = await request(authenticatedApp.getHttpServer())
        .post('/graphql')
        .send({
          query: 'query($id: ID!) { screeningAvailability(screeningId: $id) { screeningId } }',
          variables: { id: ids.screenings.auroraTypeSafeMatineeMorning },
        });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ statusCode: 401, message: 'Unauthenticated' });
    } finally {
      await authenticatedApp.close();
    }
  });

  it('rejects malformed identifiers instead of treating them as free screenings', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ screeningAvailability(screeningId: "not-a-uuid") { screeningId } }' });
    expect(response.body.errors).toBeDefined();
    expect(response.body.data?.screeningAvailability).toBeNull();
  });
});
