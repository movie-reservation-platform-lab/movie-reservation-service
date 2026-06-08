import 'reflect-metadata';

import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule, type AppModuleOptions } from './app.module';
import { config } from './config.js';
import { PinoNestLogger } from './infrastructure/observability/application-logger';
import { initializeObservabilityMetricSeries } from './infrastructure/observability/metrics/observability-metric-series';

function getNestLogger(nodeEnv: typeof config.NODE_ENV): LoggerService | false {
  if (nodeEnv === 'test') {
    return false;
  }

  return new PinoNestLogger();
}

export async function createApp(options: AppModuleOptions = {}): Promise<INestApplication> {
  initializeObservabilityMetricSeries();
  const logger = getNestLogger(config.NODE_ENV);
  const app = await NestFactory.create(AppModule.forRoot(options), {
    logger: logger,
  });
  app.enableShutdownHooks();

  return app;
}
