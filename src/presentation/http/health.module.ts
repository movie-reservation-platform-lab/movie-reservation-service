import { Module } from '@nestjs/common';

import { HealthCompositionModule } from '../../di/health/health-composition.module';
import { HealthController } from './health.controller';

@Module({
  imports: [HealthCompositionModule],
  controllers: [HealthController],
})
export class HealthModule {}
