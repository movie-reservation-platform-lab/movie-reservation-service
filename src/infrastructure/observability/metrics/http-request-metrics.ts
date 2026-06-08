import { serviceMeter } from './otel-meter';

const httpRequestTotal = serviceMeter.createCounter('http_request_total', {
  description: 'HTTP requests by method, route, and status family.',
});
const httpRequestDurationMs = serviceMeter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds.',
  unit: 'ms',
});

/**
 * Records one completed HTTP request counter and duration sample.
 */
export function recordHttpRequestMetrics(input: {
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}): void {
  const attributes = {
    http_method: input.method,
    http_route: input.route,
    status_family: `${Math.floor(input.statusCode / 100)}xx`,
  };

  httpRequestTotal.add(1, attributes);
  httpRequestDurationMs.record(input.durationMs, attributes);
}
