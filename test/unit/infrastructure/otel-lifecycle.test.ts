import { describe, expect, it, vi } from 'vitest';

import {
  startOpenTelemetry,
  type OpenTelemetryDiagnostic,
  type OpenTelemetrySdk,
} from '../../../src/infrastructure/observability/otel-lifecycle';

describe('OpenTelemetry lifecycle', () => {
  it('does not construct an SDK when telemetry is disabled', () => {
    const createSdk = vi.fn<() => OpenTelemetrySdk>();

    const lifecycle = startOpenTelemetry({
      enabled: false,
      createSdk,
      diagnosticSink: vi.fn<(diagnostic: OpenTelemetryDiagnostic) => void>(),
    });

    expect(lifecycle).toBeUndefined();
    expect(createSdk).not.toHaveBeenCalled();
  });

  it('fails open with one sanitized diagnostic when SDK construction throws an error', () => {
    const diagnostics: OpenTelemetryDiagnostic[] = [];

    const lifecycle = startOpenTelemetry({
      enabled: true,
      createSdk: () => {
        throw new Error('secret endpoint and credentials');
      },
      diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(lifecycle).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        event: 'otel.bootstrap.failed',
        error_type: 'Error',
        failure_kind: 'exception',
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('secret endpoint and credentials');
  });

  it('best-effort cleans up a partially started SDK without a second startup diagnostic', async () => {
    const diagnostics: OpenTelemetryDiagnostic[] = [];
    const shutdown = vi.fn<() => Promise<void>>(async () => undefined);

    const lifecycle = startOpenTelemetry({
      enabled: true,
      createSdk: () => ({
        start: () => {
          throw new TypeError('startup failed');
        },
        shutdown,
      }),
      diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    });
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());

    expect(lifecycle).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        event: 'otel.bootstrap.failed',
        error_type: 'TypeError',
        failure_kind: 'exception',
      },
    ]);
  });

  it('contains shutdown rejection and makes repeated shutdown calls idempotent', async () => {
    const diagnostics: OpenTelemetryDiagnostic[] = [];
    const shutdown = vi.fn<() => Promise<void>>(async () => {
      throw new Error('collector unavailable');
    });
    const lifecycle = startOpenTelemetry({
      enabled: true,
      createSdk: () => ({ start: () => undefined, shutdown }),
      diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    });

    await Promise.all([lifecycle?.shutdown(), lifecycle?.shutdown()]);

    expect(shutdown).toHaveBeenCalledOnce();
    expect(diagnostics).toEqual([
      {
        event: 'otel.shutdown.failed',
        error_type: 'Error',
        failure_kind: 'rejection',
      },
    ]);
  });

  it('bounds a shutdown operation that never settles', async () => {
    const diagnostics: OpenTelemetryDiagnostic[] = [];
    const lifecycle = startOpenTelemetry({
      enabled: true,
      createSdk: () => ({
        start: () => undefined,
        shutdown: () => new Promise<void>(() => undefined),
      }),
      diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
      shutdownTimeoutMs: 5,
    });

    await lifecycle?.shutdown();

    expect(diagnostics).toEqual([
      {
        event: 'otel.shutdown.failed',
        error_type: 'TimeoutError',
        failure_kind: 'timeout',
      },
    ]);
  });

  it('swallows a diagnostic sink failure', () => {
    expect(() =>
      startOpenTelemetry({
        enabled: true,
        createSdk: () => {
          throw new Error('startup failed');
        },
        diagnosticSink: () => {
          throw new Error('stderr unavailable');
        },
      }),
    ).not.toThrow();
  });
});
