import { createServer } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { startServiceProcess, type ServiceProcess } from '../../support/service-process';

const services = new Set<ServiceProcess>();

afterEach(async () => {
  await Promise.all([...services].map((service) => service.stop()));
  services.clear();
});

/**
 * Process-level integration test: starts the real service entrypoint with
 * OpenTelemetry instrumentation preloaded, so it is intentionally heavier than
 * an in-process unit or Supertest-style API test.
 */
describe('service availability when telemetry export is unavailable', () => {
  it('serves health and a named GraphQL query with an unreachable OTLP endpoint', async () => {
    const unusedOtlpPort = await reserveUnusedPort();
    const service = await startServiceProcess({
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'error',
        ENABLE_GRAPHIQL: 'false',
        COMPOSITION_PROFILE: 'local-fixed-user',
        RESERVATION_WORKER_MODE: 'disabled',
        RESERVATION_FAILURE_INJECTION_MODE: 'disabled',
        RESERVATION_FAILURE_INJECTION_RATE: '0',
        OBSERVABILITY_ENABLED: 'true',
        OTEL_SERVICE_NAME: 'movie-reservation-service',
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_METRICS_EXPORTER: 'none',
        OTEL_LOGS_EXPORTER: 'none',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${unusedOtlpPort}`,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_EXPORTER_OTLP_TIMEOUT: '250',
        OTEL_PROPAGATORS: 'tracecontext,baggage',
        OTEL_RESOURCE_ATTRIBUTES:
          'deployment.environment.name=availability-test,service.namespace=movie-reservation-platform',
      },
    });
    services.add(service);

    try {
      const healthResponse = await fetch(`${service.url}/health`);
      expect(healthResponse.status).toBe(200);
      expect(await healthResponse.json()).toEqual({ status: 'ok' });

      const graphQlResponse = await fetch(`${service.url}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationName: 'ObservabilityAvailabilitySmoke',
          query: 'query ObservabilityAvailabilitySmoke { movies { id } }',
        }),
      });
      const graphQlBody = (await graphQlResponse.json()) as {
        readonly data?: { readonly movies?: unknown[] };
        readonly errors?: unknown[];
      };

      expect(graphQlResponse.status).toBe(200);
      expect(graphQlBody.errors).toBeUndefined();
      expect(graphQlBody.data?.movies).toBeInstanceOf(Array);
      expect(service.child.exitCode).toBeNull();
    } catch (error) {
      throw new Error(`service output:\n${service.output()}`, { cause: error });
    }
  }, 60_000);
});

/**
 * Finds a loopback port with nothing listening, so the OTLP exporter targets an
 * unreachable endpoint. The service itself uses PORT=0 through the harness.
 */
function reserveUnusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('failed to reserve an IPv4 port'));
        return;
      }

      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}
