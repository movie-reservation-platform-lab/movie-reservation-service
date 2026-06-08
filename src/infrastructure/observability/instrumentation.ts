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
 * is stable. Compare this explicit SDK setup plus selected auto-instrumentation
 * with OpenTelemetry JS zero-code instrumentation and with a dedicated bootstrap
 * entrypoint that starts observability before dynamically importing the app.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { GraphQLInstrumentation } from '@opentelemetry/instrumentation-graphql';
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

const observabilityEnabled = process.env.OBSERVABILITY_ENABLED !== 'false' && process.env.NODE_ENV !== 'test';
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'movie-reservation-service';
const serviceVersion = process.env.SERVICE_VERSION ?? process.env.npm_package_version ?? '0.1.0';

if (observabilityEnabled) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: readPositiveIntegerEnv('OTEL_METRIC_EXPORT_INTERVAL', 5_000),
      }),
    ],
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation({
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
      }),
      new GraphQLInstrumentation({
        depth: 2,
        mergeItems: true,
      }),
      new KnexInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  sdk.start();

  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
  process.once('SIGINT', () => {
    void sdk.shutdown();
  });
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}
