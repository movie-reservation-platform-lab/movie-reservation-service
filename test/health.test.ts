import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

describe('health HTTP endpoints', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns liveness status', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /ready returns readiness status', async () => {
    const response = await request(app.getHttpServer()).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks: [] });
  });
});
