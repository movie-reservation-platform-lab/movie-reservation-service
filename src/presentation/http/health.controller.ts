import { Controller, Get, Inject } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest constructor injection metadata needs this class at runtime.
import { HealthService } from '../../application/health/health.service';
import type {
  LivenessResponse,
  ReadinessResponse,
} from '../../application/health/health.types';

@Controller()
export class HealthController {
  constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  @Get('health')
  getHealth(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }
}
