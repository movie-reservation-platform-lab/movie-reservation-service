import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import Ajv from 'ajv';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationAuditEvent } from '../../../src/application/audit/authentication-audit-event';
import schema from '../../fixtures/audit/platform-audit-event-v1.schema.json';

interface ExportedSpan {
  readonly traceId: string;
  readonly spanId: string;
}

interface TraceExport {
  readonly resourceSpans?: readonly {
    readonly scopeSpans?: readonly { readonly spans?: readonly ExportedSpan[] }[];
  }[];
}

interface DemoResponse {
  readonly authenticated: boolean;
  readonly request_id: string;
  readonly audit_event_id: string;
  readonly trace_id?: string;
}

describe('audit event correlation with the real OpenTelemetry bootstrap', () => {
  it('exports the span referenced by the live response, stdout event and operational log', async () => {
    const exports: TraceExport[] = [];
    const collector = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        exports.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as TraceExport);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    let service: ChildProcess | undefined;
    const output: string[] = [];
    try {
      const collectorPort = await listen(collector);
      service = spawn(
        process.execPath,
        ['--import', 'tsx', '--import', './src/infrastructure/observability/instrumentation.ts', 'src/index.ts'],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: 'development',
            HOST: '127.0.0.1',
            PORT: '0',
            LOG_LEVEL: 'info',
            COMPOSITION_PROFILE: 'local-fixed-user',
            ENABLE_GRAPHIQL: 'false',
            RESERVATION_WORKER_MODE: 'disabled',
            RESERVATION_FAILURE_INJECTION_MODE: 'disabled',
            RESERVATION_FAILURE_INJECTION_RATE: '0',
            DEMO_AUTH_ENABLED: 'true',
            DEMO_AUTH_USERNAME: 'test-user',
            DEMO_AUTH_PASSWORD: 'test-only-password',
            DEPLOYMENT_ENVIRONMENT: 'test',
            SERVICE_VERSION: 'audit-trace-test',
            OBSERVABILITY_ENABLED: 'true',
            OTEL_SDK_DISABLED: 'false',
            OTEL_SERVICE_NAME: 'movie-reservation-service',
            OTEL_TRACES_EXPORTER: 'otlp',
            OTEL_METRICS_EXPORTER: 'none',
            OTEL_LOGS_EXPORTER: 'none',
            OTEL_TRACES_SAMPLER: 'always_on',
            OTEL_PROPAGATORS: 'tracecontext,baggage',
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${collectorPort}/v1/traces`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
            OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
            OTEL_EXPORTER_OTLP_COMPRESSION: 'none',
            OTEL_BSP_SCHEDULE_DELAY: '100',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      service.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
      service.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

      let serviceUrl = '';
      await vi.waitFor(
        () => {
          expect(service?.exitCode).toBeNull();
          const match = output.join('').match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
          expect(match).not.toBeNull();
          serviceUrl = match?.[1] ?? '';
        },
        { timeout: 10_000 },
      );

      const response = await fetch(`${serviceUrl}/demo/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'live-request-1',
          'x-correlation-id': 'live-action-1',
          traceparent: '00-6a9dd2710123456789abcdef01234567-1111111111111111-01',
          'x-amzn-trace-id': 'Root=1-6a9dd271-0123456789abcdef01234567',
        },
        body: JSON.stringify({ username: 'private-user-attempt', password: 'private-wrong-attempt' }),
      });
      const body = (await response.json()) as DemoResponse;
      expect(response.status).toBe(401);
      expect(body.trace_id).toBe('6a9dd2710123456789abcdef01234567');

      let audit: AuthenticationAuditEvent | undefined;
      await vi.waitFor(
        () => {
          const auditLine = output
            .join('')
            .split('\n')
            .find((line) => line.startsWith('{"audit":'));
          expect(auditLine).toBeDefined();
          audit = (JSON.parse(auditLine ?? '{}') as { audit: AuthenticationAuditEvent }).audit;
          expect(new Ajv({ strict: false }).validate(schema, audit)).toBe(true);
          expect(audit.metadata.uid).toBe(body.audit_event_id);
          const spans = exports
            .flatMap((entry) => entry.resourceSpans ?? [])
            .flatMap((resource) => resource.scopeSpans ?? [])
            .flatMap((scope) => scope.spans ?? []);
          expect(spans).toContainEqual(
            expect.objectContaining({
              traceId: body.trace_id,
              spanId: audit.unmapped.platform.span_id,
            }),
          );
        },
        { timeout: 5_000 },
      );

      const operationalLine = output
        .join('')
        .split('\n')
        .find((line) => line.includes('"event":"audit.authentication"'));
      expect(operationalLine).toContain(body.audit_event_id);
      expect(operationalLine).toContain(body.trace_id);
      expect(audit?.unmapped.platform.aws_alb_trace_id).toBe('Root=1-6a9dd271-0123456789abcdef01234567');
      expect(output.join('')).not.toContain('private-user-attempt');
      expect(output.join('')).not.toContain('private-wrong-attempt');
    } catch (error) {
      throw new Error(`Service output:\n${output.join('')}`, { cause: error });
    } finally {
      if (service !== undefined) {
        await stop(service);
      }
      await new Promise<void>((resolve) => collector.close(() => resolve()));
    }
  }, 20_000);
});

async function listen(server: Server): Promise<number> {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a loopback listener');
  }
  return address.port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000);
  child.kill('SIGTERM');
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}
