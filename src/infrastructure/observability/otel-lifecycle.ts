export interface OpenTelemetrySdk {
  start(): void;
  shutdown(): Promise<void>;
}

export interface OpenTelemetryDiagnostic {
  readonly event: 'otel.bootstrap.failed' | 'otel.shutdown.failed';
  readonly error_type: string;
  readonly failure_kind: 'exception' | 'rejection' | 'timeout';
}

export type OpenTelemetryDiagnosticSink = (diagnostic: OpenTelemetryDiagnostic) => void;

export interface OpenTelemetryLifecycle {
  shutdown(): Promise<void>;
}

export interface StartOpenTelemetryOptions {
  readonly enabled: boolean;
  readonly createSdk: () => OpenTelemetrySdk;
  readonly diagnosticSink: OpenTelemetryDiagnosticSink;
  readonly shutdownTimeoutMs?: number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;

/**
 * Starts telemetry without making application availability depend on it.
 *
 * The returned shutdown operation is bounded and idempotent. Diagnostics expose
 * only stable classifications; raw errors and environment values stay out of
 * this early process-level logging path.
 */
export function startOpenTelemetry(options: StartOpenTelemetryOptions): OpenTelemetryLifecycle | undefined {
  if (!options.enabled) {
    return undefined;
  }

  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let sdk: OpenTelemetrySdk | undefined;

  try {
    sdk = options.createSdk();
    sdk.start();
  } catch (error) {
    emitDiagnostic(options.diagnosticSink, {
      event: 'otel.bootstrap.failed',
      error_type: classifyError(error),
      failure_kind: 'exception',
    });

    if (sdk !== undefined) {
      void shutDownSdk(sdk, shutdownTimeoutMs);
    }

    return undefined;
  }

  let shutdownPromise: Promise<void> | undefined;

  return {
    shutdown(): Promise<void> {
      shutdownPromise ??= shutDownSdk(sdk, shutdownTimeoutMs, options.diagnosticSink);
      return shutdownPromise;
    },
  };
}

/** Writes one structured OpenTelemetry lifecycle warning to standard error. */
export function writeOpenTelemetryDiagnostic(diagnostic: OpenTelemetryDiagnostic): void {
  process.stderr.write(`${JSON.stringify({ level: 'warn', ...diagnostic })}\n`);
}

/** Attempts SDK shutdown without propagating failures or waiting beyond the timeout. */
async function shutDownSdk(
  sdk: OpenTelemetrySdk,
  timeoutMs: number,
  diagnosticSink?: OpenTelemetryDiagnosticSink,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutResult = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), timeoutMs);
    timeout.unref();
  });
  const shutdownResult = Promise.resolve()
    .then(async () => sdk.shutdown())
    .then(
      () => ({ result: 'completed' as const }),
      (error: unknown) => ({ result: 'rejection' as const, error }),
    );

  const result = await Promise.race([shutdownResult, timeoutResult]);
  if (timeout !== undefined) {
    clearTimeout(timeout);
  }

  if (result === 'timeout') {
    if (diagnosticSink !== undefined) {
      emitDiagnostic(diagnosticSink, {
        event: 'otel.shutdown.failed',
        error_type: 'TimeoutError',
        failure_kind: 'timeout',
      });
    }
    return;
  }

  if (result.result === 'rejection' && diagnosticSink !== undefined) {
    emitDiagnostic(diagnosticSink, {
      event: 'otel.shutdown.failed',
      error_type: classifyError(result.error),
      failure_kind: 'rejection',
    });
  }
}

/** Return safe error classification without exposing raw error details. */
function classifyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'NonErrorThrown';
  }

  return /^[A-Za-z][A-Za-z0-9]*Error$/.test(error.name) ? error.name : 'Error';
}

/** Invokes a diagnostic sink without allowing sink failures to escape. */
function emitDiagnostic(sink: OpenTelemetryDiagnosticSink, diagnostic: OpenTelemetryDiagnostic): void {
  try {
    sink(diagnostic);
  } catch {
    // Telemetry diagnostics must not become an application startup dependency.
  }
}
