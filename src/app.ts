import 'reflect-metadata';

import type { INestApplication, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule, type AppModuleOptions } from './app.module';
import { config } from './config.js';

/**
 * TODO: move the logging setup to a dedicated place - its a cross cutting
 *  concern, refactor into structured logging
 */
function getNestLogger(
  logLevel: typeof config.LOG_LEVEL,
  nodeEnv: typeof config.NODE_ENV,
): LogLevel[] | false {
  if (nodeEnv === 'test') {
    return false;
  }

  if (logLevel === 'debug') {
    return ['debug', 'log', 'warn', 'error'];
  }

  if (logLevel === 'warn') {
    return ['warn', 'error'];
  }

  if (logLevel === 'error') {
    return ['error'];
  }

  return ['log', 'warn', 'error'];
}

export async function createApp(
  options: AppModuleOptions = {},
): Promise<INestApplication> {
  const logger = getNestLogger(config.LOG_LEVEL, config.NODE_ENV);
  return NestFactory.create(AppModule.forRoot(options), {
    logger: logger,
  });
}
