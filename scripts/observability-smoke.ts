/**
 * Local observability smoke check.
 *
 * This script exercises the API and app-local collector without depending on
 * Grafana, Tempo, Loki, or Prometheus APIs. Its job is to catch basic wiring
 * mistakes: request/correlation headers are echoed by the API, GraphQL traffic
 * reaches the service, and the local collector exposes at least one GraphQL
 * metric after export. Keep it lightweight; fuller observability e2e tests can
 * replace or retire this once the backend stack is automated.
 */
import { randomBytes } from 'node:crypto';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const collectorMetricsUrl = process.env.OTEL_COLLECTOR_METRICS_URL ?? 'http://127.0.0.1:18889/metrics';

async function main(): Promise<void> {
  const correlationId = `smoke-correlation-${Date.now()}`;
  const requestId = `smoke-request-${Date.now()}`;
  const traceparent = createTraceparent();

  const healthResponse = await fetch(`${apiBaseUrl}/health`, {
    headers: {
      'X-Correlation-Id': correlationId,
      'X-Request-Id': requestId,
      traceparent,
    },
  });

  assertStatus(healthResponse, 200, '/health');
  assertHeader(healthResponse, 'x-correlation-id', correlationId);
  assertHeader(healthResponse, 'x-request-id', requestId);

  const graphqlResponse = await fetch(`${apiBaseUrl}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'X-Request-Id': requestId,
      traceparent,
    },
    body: JSON.stringify({
      query: `
        query ObservabilitySmokeMovies {
          movies {
            id
            title
          }
        }
      `,
    }),
  });

  assertStatus(graphqlResponse, 200, '/graphql');
  const graphqlPayload = (await graphqlResponse.json()) as { readonly errors?: readonly unknown[] };

  if (graphqlPayload.errors !== undefined && graphqlPayload.errors.length > 0) {
    throw new Error(`GraphQL smoke query returned errors: ${JSON.stringify(graphqlPayload.errors)}`);
  }

  await waitForCollectorMetric();

  console.log(
    JSON.stringify({
      status: 'ok',
      api_base_url: apiBaseUrl,
      collector_metrics_url: collectorMetricsUrl,
      correlation_id: correlationId,
      request_id: requestId,
      traceparent,
    }),
  );
}

function assertStatus(response: Response, expectedStatus: number, label: string): void {
  if (response.status !== expectedStatus) {
    throw new Error(`${label} returned ${response.status}; expected ${expectedStatus}`);
  }
}

function assertHeader(response: Response, headerName: string, expectedValue: string): void {
  const actualValue = response.headers.get(headerName);

  if (actualValue !== expectedValue) {
    throw new Error(`${headerName} response header was ${actualValue ?? '<missing>'}; expected ${expectedValue}`);
  }
}

async function waitForCollectorMetric(): Promise<void> {
  await pollCollectorMetric(Date.now() + 30_000);
}

async function pollCollectorMetric(deadline: number): Promise<void> {
  try {
    const response = await fetch(collectorMetricsUrl);

    assertStatus(response, 200, 'collector metrics');

    const metricsText = await response.text();

    if (metricsText.includes('graphql_operation')) {
      return;
    }

    return retryCollectorMetricPoll(
      deadline,
      new Error('collector metrics endpoint did not include graphql_operation metrics yet'),
    );
  } catch (error) {
    return retryCollectorMetricPoll(deadline, error instanceof Error ? error : new Error(String(error)));
  }
}

async function retryCollectorMetricPoll(deadline: number, error: Error): Promise<void> {
  if (Date.now() >= deadline) {
    throw error;
  }

  await delay(1_000);
  await pollCollectorMetric(deadline);
}

function createTraceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});
