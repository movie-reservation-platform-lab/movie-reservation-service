import { describe, expect, it } from 'vitest';

import { HealthService } from '../../../src/application/health/health.service';

describe('HealthService', () => {
  it('returns liveness status', () => {
    const service = new HealthService();

    expect(service.getLiveness()).toEqual({ status: 'ok' });
  });

  it('returns readiness status with no checks in phase 1', async () => {
    const service = new HealthService();

    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ready',
      checks: [],
    });
  });
});
