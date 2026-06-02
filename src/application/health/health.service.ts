import type { LivenessResponse, ReadinessResponse } from './health.types';
import type { ReadinessCheck } from './ports/readiness-check';

export class HealthService {
  constructor(private readonly readinessChecks: readonly ReadinessCheck[] = []) {}

  getLiveness(): LivenessResponse {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const checks = await Promise.all(this.readinessChecks.map((readinessCheck) => readinessCheck.check()));

    return {
      status: 'ready',
      checks,
    };
  }
}
