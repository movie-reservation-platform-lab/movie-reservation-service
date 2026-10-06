import { randomUUID } from 'node:crypto';

import { FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';
import type { INestApplication } from '@nestjs/common';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppModuleOptions } from '../../../src/app.module';
import type { AuthenticationAuditRecorder } from '../../../src/application/audit/ports/authentication-audit-recorder';
import type { ReservationRequestProcessor } from '../../../src/application/movie-reservations/ports/reservation-request-processor';
// Type-only: the runtime modules are imported after the test MeterProvider is registered.
import type * as MeteredPublisherModule from '../../../src/infrastructure/audit/metered-audit-publisher';
import type * as RecorderModule from '../../../src/infrastructure/audit/request-authentication-audit-recorder';
import type * as AuditPublishMetricsModule from '../../../src/infrastructure/observability/metrics/audit-publish-metrics';

interface AppFactoryModule {
  createApp(options?: AppModuleOptions): Promise<INestApplication>;
}

interface MeteredAuditModules {
  readonly recorder: typeof RecorderModule;
  readonly metered: typeof MeteredPublisherModule;
  readonly metrics: typeof AuditPublishMetricsModule;
}

interface MovieReservationTokensModule {
  readonly RESERVATION_REQUEST_PROCESSOR: symbol;
}

interface MetricPoint {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly value: number | { readonly count: number; readonly sum?: number };
}

interface ExportedMetric {
  readonly descriptor: { readonly name: string; readonly unit: string };
  readonly dataPoints: readonly MetricPoint[];
}

interface ResourceMetricExport {
  readonly resource: { readonly attributes: Readonly<Record<string, unknown>> };
  readonly scopeMetrics: readonly { readonly metrics: readonly ExportedMetric[] }[];
}

describe('reservation service emitted signal contract', () => {
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
  const spanExporter = new InMemorySpanExporter();
  const resource = resourceFromAttributes({
    'service.name': 'movie-reservation-service',
    'service.version': 'signal-contract-test',
    'deployment.environment.name': 'test',
  });
  const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();
  let successfulApp: INestApplication;
  let failingApp: INestApplication;
  let serverErrorApp: INestApplication;

  beforeAll(async () => {
    vi.resetModules();
    metrics.disable();
    trace.disable();
    propagation.disable();
    context.disable();
    context.setGlobalContextManager(contextManager.enable());
    metrics.setGlobalMeterProvider(meterProvider);
    trace.setGlobalTracerProvider(tracerProvider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    const appFactoryModule = (await import('../../../src/app.js')) as unknown as AppFactoryModule;
    const auditModules: MeteredAuditModules = {
      recorder: await import('../../../src/infrastructure/audit/request-authentication-audit-recorder.js'),
      metered: await import('../../../src/infrastructure/audit/metered-audit-publisher.js'),
      metrics: await import('../../../src/infrastructure/observability/metrics/audit-publish-metrics.js'),
    };

    successfulApp = await appFactoryModule.createApp({
      authMode: 'local-fixed-user',
      reservationWorkerMode: 'disabled',
      authenticationAuditRecorder: createMeteredAuditRecorder(auditModules),
      demoAuth: { enabled: true, username: 'test-user', password: 'test-password' },
    });
    failingApp = await appFactoryModule.createApp({
      authMode: 'local-fixed-user',
      reservationWorkerMode: 'disabled',
      reservationFailureInjection: {
        mode: 'stable-random-unexpected-error',
        failureRate: 1,
        salt: 'signal-contract-test',
      },
      authenticationAuditRecorder: createAcceptingAuditRecorder(),
    });
    serverErrorApp = await appFactoryModule.createApp({
      authMode: 'local-fixed-user',
      reservationWorkerMode: 'disabled',
      authenticationAuditRecorder: {
        // An unexpected recorder defect, not an unavailable publisher (demo login fails open on that).
        async record(): Promise<never> {
          throw new Error('recorder defect');
        },
      },
      demoAuth: { enabled: true, username: 'test-user', password: 'test-password' },
    });
    await Promise.all([successfulApp.init(), failingApp.init(), serverErrorApp.init()]);
    // Re-importing the full app graph (so instruments bind to this MeterProvider) and
    // booting three apps is heavy by design; the 10 s default is too tight under load.
  }, 30_000);

  afterAll(async () => {
    await Promise.all([successfulApp.close(), failingApp.close(), serverErrorApp.close()]);
    await meterProvider.shutdown();
    await tracerProvider.shutdown();
    metrics.disable();
    trace.disable();
    propagation.disable();
    context.disable();
    contextManager.disable();
  });

  it('exports bounded HTTP, GraphQL, and worker outcomes with connected worker traces', async () => {
    metricExporter.reset();
    spanExporter.reset();

    await request(successfulApp.getHttpServer()).get('/health').expect(200);
    await request(successfulApp.getHttpServer()).get('/ready').expect(200);
    await request(successfulApp.getHttpServer())
      .post('/demo/auth/login')
      .send({ username: 'test-user', password: 'test-password' })
      .expect(200);
    await request(successfulApp.getHttpServer())
      .post('/demo/auth/login')
      .send({ username: 'test-user', password: 'wrong' })
      .expect(401);
    await request(serverErrorApp.getHttpServer())
      .post('/demo/auth/login')
      .send({ username: 'test-user', password: 'test-password' })
      .expect(500);
    await request(successfulApp.getHttpServer()).get('/caller-controlled-value').expect(404);

    await graphql(successfulApp, '{ movies { id title } }').expect(200);
    const businessFailure = await graphql(
      successfulApp,
      `
        mutation DuplicateReservation {
          requestReservation(
            input: {
              screeningId: "55555555-5555-4555-8555-555555555551"
              seatIds: ["66666666-6666-4666-8666-666666666663", "66666666-6666-4666-8666-666666666663"]
            }
          ) {
            id
          }
        }
      `,
    ).expect(200);
    expect((businessFailure.body as unknown as { readonly data: unknown }).data).toBeNull();

    await createAndProcessReservation(successfulApp, '66666666-6666-4666-8666-666666666663', 'confirmed');
    await createAndProcessReservation(failingApp, '66666666-6666-4666-8666-666666666663', 'retryable-failure');

    await meterProvider.forceFlush();
    await tracerProvider.forceFlush();

    const exports = metricExporter.getMetrics() as unknown as readonly ResourceMetricExport[];
    expect(exports.at(-1)?.resource.attributes).toMatchObject({
      'service.name': 'movie-reservation-service',
      'service.version': 'signal-contract-test',
      'deployment.environment.name': 'test',
    });

    const httpTotal = requireMetric(exports, 'http_request_total');
    expect(httpTotal.descriptor.unit).toBe('');
    expect(sumPoints(httpTotal.dataPoints)).toBe(8);
    expect(
      findPointValue(httpTotal, {
        http_route: '/demo/auth/login',
        http_status_code: 500,
        status_family: '5xx',
        outcome: 'server_error',
      }),
    ).toBe(1);
    expect(findPointValue(httpTotal, { http_route: 'unmatched', http_status_code: 404 })).toBe(1);
    expect(httpTotal.dataPoints.some((point) => point.attributes.http_route === '/health')).toBe(false);
    expect(httpTotal.dataPoints.some((point) => point.attributes.http_route === '/ready')).toBe(false);
    expect(JSON.stringify(httpTotal.dataPoints)).not.toContain('caller-controlled-value');

    const httpDuration = requireMetric(exports, 'http_request_duration_ms');
    expect(httpDuration.descriptor.unit).toBe('ms');
    expect(sumHistogramCounts(httpDuration.dataPoints)).toBe(8);

    const graphqlTotal = requireMetric(exports, 'graphql_operation_total');
    expect(findPointValue(graphqlTotal, { business_operation: 'movies', outcome: 'success' })).toBe(1);
    expect(findPointValue(graphqlTotal, { business_operation: 'requestReservation', outcome: 'graphql_error' })).toBe(
      1,
    );
    expect(findPointValue(graphqlTotal, { business_operation: 'requestReservation', outcome: 'auth_error' })).toBe(0);

    const auditTotal = requireMetric(exports, 'audit_publish_total');
    expect(auditTotal.descriptor.unit).toBe('');
    const auditBase = { audit_publisher: 'stdout', audit_publisher_role: 'primary' };
    expect(findPointValue(auditTotal, { ...auditBase, result: 'accepted', failure_reason: 'none' })).toBe(2);
    expect(findPointValue(auditTotal, { ...auditBase, result: 'failed', failure_reason: 'timeout' })).toBe(0);
    for (const point of auditTotal.dataPoints) {
      expect(Object.keys(point.attributes).sort()).toEqual([
        'audit_publisher',
        'audit_publisher_role',
        'failure_reason',
        'result',
      ]);
    }
    const auditDuration = requireMetric(exports, 'audit_publish_duration_ms');
    expect(auditDuration.descriptor.unit).toBe('ms');
    expect(sumHistogramCounts(auditDuration.dataPoints)).toBe(2);

    const workerTotal = requireMetric(exports, 'reservation_processor_outcome_total');
    expect(findPointValue(workerTotal, { outcome: 'confirmed' })).toBe(1);
    expect(findPointValue(workerTotal, { outcome: 'retryable-failure' })).toBe(1);
    expect(workerTotal.dataPoints.every((point) => !('reason' in point.attributes))).toBe(true);

    const workerDuration = requireMetric(exports, 'reservation_processor_duration_ms');
    expect(workerDuration.descriptor.unit).toBe('ms');
    expect(sumHistogramCounts(workerDuration.dataPoints)).toBe(2);

    const workerSpans = spanExporter.getFinishedSpans().filter((span) => span.name === 'reservation_request.process');
    expect(workerSpans).toHaveLength(2);
    expect(workerSpans.map((span) => span.parentSpanContext?.spanId)).toEqual(['bbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbb']);
    expect(workerSpans.map((span) => span.attributes['reservation_processor.outcome'])).toEqual([
      'confirmed',
      'retryable-failure',
    ]);
    expect(workerSpans[0]?.status.code).not.toBe(workerSpans[1]?.status.code);
  }, 20_000);
});

/** Real recorder and metered publisher (bound to this test's MeterProvider) over an in-memory transport. */
function createMeteredAuditRecorder(modules: MeteredAuditModules): AuthenticationAuditRecorder {
  modules.metrics.initializeAuditPublishMetricSeries('stdout', 'primary');
  return new modules.recorder.RequestAuthenticationAuditRecorder(
    { serviceName: 'movie-reservation-service', serviceVersion: 'signal-contract-test', environment: 'test' },
    new modules.metered.MeteredAuditPublisher(new FakeAuditPublisher(), { publisher: 'stdout', role: 'primary' }),
    { info: () => undefined, error: () => undefined },
  );
}

function createAcceptingAuditRecorder(): AuthenticationAuditRecorder {
  return {
    async record() {
      return { request_id: randomUUID(), audit_event_id: randomUUID() };
    },
  };
}

function graphql(app: INestApplication, query: string) {
  return request(app.getHttpServer()).post('/graphql').set('Content-Type', 'application/json').send({ query });
}

async function createAndProcessReservation(
  app: INestApplication,
  seatId: string,
  expectedOutcome: 'confirmed' | 'retryable-failure',
): Promise<void> {
  const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
  const response = await request(app.getHttpServer())
    .post('/graphql')
    .set('traceparent', traceparent)
    .send({
      query: `mutation CreateReservation {
        requestReservation(input: {
          screeningId: "55555555-5555-4555-8555-555555555551"
          seatIds: ["${seatId}"]
        }) { id status }
      }`,
    })
    .expect(200);
  expect((response.body as unknown as { readonly errors?: unknown }).errors).toBeUndefined();

  const tokens =
    (await import('../../../src/di/movie-reservations/movie-reservation.tokens.js')) as unknown as MovieReservationTokensModule;
  const processor = app.get<ReservationRequestProcessor>(tokens.RESERVATION_REQUEST_PROCESSOR);
  await expect(processor.processNextPendingRequest()).resolves.toMatchObject({ outcome: expectedOutcome });
}

function requireMetric(exports: readonly ResourceMetricExport[], name: string): ExportedMetric {
  const metric = exports
    .flatMap((entry) => entry.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === name);

  if (metric === undefined) {
    throw new Error(`Expected exported metric ${name}`);
  }

  return metric;
}

function sumPoints(points: readonly MetricPoint[]): number {
  return points.reduce((total, point) => total + (typeof point.value === 'number' ? point.value : 0), 0);
}

function sumHistogramCounts(points: readonly MetricPoint[]): number {
  return points.reduce((total, point) => total + (typeof point.value === 'number' ? 0 : point.value.count), 0);
}

function findPointValue(metric: ExportedMetric, expectedAttributes: Readonly<Record<string, unknown>>): number {
  const point = metric.dataPoints.find((candidate) =>
    Object.entries(expectedAttributes).every(([name, value]) => candidate.attributes[name] === value),
  );

  if (point === undefined || typeof point.value !== 'number') {
    throw new Error(`Expected point in ${metric.descriptor.name}: ${JSON.stringify(expectedAttributes)}`);
  }

  return point.value;
}
