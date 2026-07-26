/**
 * OpenTelemetry bootstrap for the service process.
 *
 * This module is loaded with Node's `--import` flag before `src/index.ts`.
 * That import order is intentional: OpenTelemetry instrumentation wraps
 * libraries such as HTTP, Express, GraphQL, Knex, and pg as they are loaded, so
 * this setup must run before the Nest application imports those dependencies.
 *
 * Keep this module free of application imports. It has import-time side effects:
 * when observability is enabled it creates the NodeSDK, starts it, and registers
 * process shutdown hooks.
 *
 * TODO: Re-evaluate this startup shape after the local observability foundation
 *  is stable. Compare this explicit SDK setup plus selected auto-instrumentation
 *  with OpenTelemetry JS zero-code instrumentation and with a dedicated bootstrap
 *  entrypoint that starts observability before dynamically importing the app.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { GraphQLInstrumentation } from '@opentelemetry/instrumentation-graphql';
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

import { SERVICE_VERSION } from '../../service-metadata.js';
import { startOpenTelemetry, writeOpenTelemetryDiagnostic } from './otel-lifecycle.js';

const observabilityEnabled = process.env.OBSERVABILITY_ENABLED !== 'false' && process.env.NODE_ENV !== 'test';
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'movie-reservation-service';

/**
 * Creates the service's NodeSDK with explicit resource identity and selected instrumentations.
 *
 * Exporter selection remains controlled by standard OpenTelemetry environment variables.
 */
function createOpenTelemetrySdk(): NodeSDK {
  return new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? SERVICE_VERSION,
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation({
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
      }),
      new GraphQLInstrumentation({
        allowValues: false,
        depth: 2,
        mergeItems: true,
      }),
      new KnexInstrumentation(),
      new PgInstrumentation(),
    ],
  });
}

const telemetry = startOpenTelemetry({
  enabled: observabilityEnabled,
  diagnosticSink: writeOpenTelemetryDiagnostic,
  createSdk: createOpenTelemetrySdk,
});

if (telemetry !== undefined) {
  process.once('SIGTERM', () => {
    void telemetry.shutdown();
  });
  process.once('SIGINT', () => {
    void telemetry.shutdown();
  });
}
