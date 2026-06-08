import { Injectable, type NestMiddleware } from '@nestjs/common';

import { applicationLogger } from '../../../infrastructure/observability/application-logger';
import { createRequestContext } from '../../../infrastructure/observability/request-context-factory';
import { runWithRequestContext, type RequestContext } from '../../../infrastructure/observability/request-context';
import { recordHttpRequestMetrics } from '../../../infrastructure/observability/metrics/http-request-metrics';

interface RequestContextHttpRequest {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

interface RequestContextHttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: 'finish', listener: () => void): void;
}

interface FinishedHttpRequestInput {
  readonly req: RequestContextHttpRequest;
  readonly res: RequestContextHttpResponse;
  readonly context: RequestContext;
  readonly startedAt: bigint;
}

/**
 * Creates the per-request observability context at the inbound HTTP boundary.
 *
 * The context is stored in AsyncLocalStorage so logs emitted later in the same
 * request lifecycle can be enriched with correlation, request, trace, and
 * caller context without passing those fields through every function call.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestContextHttpRequest, res: RequestContextHttpResponse, next: () => void): void {
    const startedAt = process.hrtime.bigint();
    const extractedMethod = req.method === undefined ? {} : { method: req.method };
    const requestPath = req.originalUrl ?? req.url;
    const extractedPath = requestPath === undefined ? {} : { path: requestPath };

    const context = createRequestContext({
      ...extractedMethod,
      ...extractedPath,
      correlationIdHeader: req.headers['x-correlation-id'],
      requestIdHeader: req.headers['x-request-id'],
      traceparentHeader: req.headers.traceparent,
      tracestateHeader: req.headers.tracestate,
      awsXAmznTraceIdHeader: req.headers['x-amzn-trace-id'],
    });

    res.setHeader('X-Correlation-Id', context.correlationId);
    res.setHeader('X-Request-Id', context.requestId);

    runWithRequestContext(context, () => {
      res.on('finish', () => {
        recordFinishedHttpRequest({ req, res, context, startedAt });
      });

      next();
    });
  }
}

/**
 * Records the completed HTTP boundary event.
 *
 * Metrics are emitted for every route, while structured request-finish logs
 * skip platform health checks to keep normal logs focused on user/API traffic.
 */
function recordFinishedHttpRequest(input: FinishedHttpRequestInput): void {
  const durationMs = Number(process.hrtime.bigint() - input.startedAt) / 1_000_000;
  const route = readRoute(input.req);
  const method = input.req.method ?? 'UNKNOWN';

  recordHttpRequestMetrics({
    method,
    route,
    statusCode: input.res.statusCode,
    durationMs,
  });

  if (!shouldLogHttpRequest(route)) {
    return;
  }

  const amznTraceContainer =
    input.context.awsXAmznTraceId === undefined ? {} : { aws_x_amzn_trace_id: input.context.awsXAmznTraceId };

  applicationLogger.info('http.request.finish', {
    http_status_code: input.res.statusCode,
    duration_ms: durationMs,
    request_id: input.context.requestId,
    ...amznTraceContainer,
    http_method: method,
    http_route: route,
  });
}

function readRoute(req: RequestContextHttpRequest): string {
  return req.originalUrl ?? req.url ?? 'unknown';
}

function shouldLogHttpRequest(route: string): boolean {
  const path = route.split('?')[0];

  return path !== '/health' && path !== '/ready';
}
