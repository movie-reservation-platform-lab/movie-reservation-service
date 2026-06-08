import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';

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

  it('GET /health echoes caller-provided correlation and request ids', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('X-Correlation-Id', 'test-correlation-id')
      .set('X-Request-Id', 'test-request-id');

    expect(response.status).toBe(200);
    expect(response.headers['x-correlation-id']).toBe('test-correlation-id');
    expect(response.headers['x-request-id']).toBe('test-request-id');
  });

  it('GET /ready returns readiness status', async () => {
    const response = await request(app.getHttpServer()).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks: [] });
  });

  it('GET /ready generates correlation and request ids when callers omit them', async () => {
    const response = await request(app.getHttpServer()).get('/ready');

    expect(response.status).toBe(200);
    expect(response.headers['x-correlation-id']).toEqual(expect.any(String));
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });
});
