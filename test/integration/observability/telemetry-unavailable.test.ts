import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

const childProcesses = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...childProcesses].map(stopChildProcess));
  childProcesses.clear();
});

/**
 * Process-level integration test: starts the real service entrypoint with
 * OpenTelemetry instrumentation preloaded, so it is intentionally heavier than
 * an in-process unit or Supertest-style API test.
 */
describe('service availability when telemetry export is unavailable', () => {
  it('serves health and a named GraphQL query with an unreachable OTLP endpoint', async () => {
    const [appPort, unusedOtlpPort] = await Promise.all([reserveUnusedPort(), reserveUnusedPort()]);
    const output: string[] = [];
    const serviceProcess = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', './src/infrastructure/observability/instrumentation.ts', 'src/index.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PORT: appPort.toString(),
          HOST: '127.0.0.1',
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
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    childProcesses.add(serviceProcess);
    collectOutput(serviceProcess, output);

    try {
      const healthResponse = await waitForHealthyService(`http://127.0.0.1:${appPort}/health`, serviceProcess);
      expect(await healthResponse.json()).toEqual({ status: 'ok' });

      const graphQlResponse = await fetch(`http://127.0.0.1:${appPort}/graphql`, {
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
      expect(serviceProcess.exitCode).toBeNull();
    } catch (error) {
      throw new Error(`service output:\n${output.join('')}`, { cause: error });
    }
  }, 20_000);
});

/**
 * TODO: Revisit port allocation. Prefer binding the service to PORT=0 and
 * reading its startup URL, then model the unavailable OTLP endpoint without a
 * close-and-reuse port reservation.
 *
 * Finds an available loopback port for a short-lived test service dependency.
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

/**
 * Waits for the spawned service to report healthy before exercising GraphQL.
 */
async function waitForHealthyService(url: string, serviceProcess: ChildProcess): Promise<Response> {
  return pollForHealthyService(url, serviceProcess, Date.now() + 10_000);
}

/**
 * Polls health until the service responds, exits, or the startup deadline passes.
 */
async function pollForHealthyService(url: string, serviceProcess: ChildProcess, deadline: number): Promise<Response> {
  if (serviceProcess.exitCode !== null) {
    throw new Error(`service exited with code ${serviceProcess.exitCode}`);
  }

  try {
    const response = await fetch(url);
    if (response.ok) {
      return response;
    }
  } catch {
    // The server is still starting.
  }

  if (Date.now() >= deadline) {
    throw new Error('service did not become healthy within 10 seconds');
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  return pollForHealthyService(url, serviceProcess, deadline);
}

/**
 * Captures child stdout/stderr so failures include service startup context.
 */
function collectOutput(childProcess: ChildProcess, output: string[]): void {
  childProcess.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  childProcess.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
}

/**
 * Stops a spawned service process, escalating to SIGKILL after a grace period.
 */
async function stopChildProcess(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  const exit = new Promise<true>((resolve) => childProcess.once('exit', () => resolve(true)));
  childProcess.kill('SIGTERM');
  const stopped = await Promise.race([exit, new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000))]);

  if (!stopped) {
    childProcess.kill('SIGKILL');
  }
}
