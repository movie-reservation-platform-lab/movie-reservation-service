import { Module } from '@nestjs/common';

import { HealthService } from '../../application/health/health.service';
import type { ReadinessCheck } from '../../application/health/ports/readiness-check';

const READINESS_CHECKS = Symbol('READINESS_CHECKS');

@Module({
  providers: [
    {
      provide: READINESS_CHECKS,
      useValue: [],
    },
    {
      provide: HealthService,
      useFactory: (readinessChecks: readonly ReadinessCheck[]): HealthService =>
        new HealthService(readinessChecks),
      inject: [READINESS_CHECKS],
    },
  ],
  exports: [HealthService],
})
export class HealthCompositionModule {}
