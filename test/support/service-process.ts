import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { transformFile, type Options } from '@swc/core';

const repositoryRoot = process.cwd();
const buildParentDirectory = join(
  repositoryRoot,
  'node_modules',
  '.cache',
  'movie-reservation-service',
  'process-tests',
);

// Same decorator settings as vitest.config.ts, emitted as CommonJS like `npm run build`.
const swcOptions: Options = {
  sourceMaps: 'inline',
  module: { type: 'commonjs' },
  jsc: {
    target: 'es2022',
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
  },
};

export interface ServiceProcessOptions {
  /** Environment for the service; `PORT` and `HOST` are set by the harness. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * `transpiled` (default) runs an SWC build of `src/`. `tsx` runs the `npm run dev`
   * runner from the repository root; use it only to cover tsx-specific behavior, such
   * as its missing decorator metadata, and note that it rewrites the tracked `schema.gql`.
   */
  readonly runtime?: 'transpiled' | 'tsx';
  /** Liveness guard for startup, not a performance assertion. */
  readonly startupTimeoutMs?: number;
}

export interface ServiceProcess {
  readonly url: string;
  readonly child: ChildProcess;
  output(): string;
  stop(): Promise<void>;
}

/**
 * Starts the real service entrypoint in a child process: the OpenTelemetry
 * bootstrap is preloaded with `--import` before `index`, as in production.
 *
 * By default the service runs from an SWC transpile of `src/` instead of tsx.
 * OpenTelemetry's require hook resolves every `require()`, and tsx's
 * TypeScript-aware resolver made that roughly double startup time. The build
 * directory has its own `package.json`, so the child writes `schema.gql` there,
 * not to the tracked file.
 */
export async function startServiceProcess(options: ServiceProcessOptions): Promise<ServiceProcess> {
  const runtime = options.runtime ?? 'transpiled';
  const buildDirectory = runtime === 'transpiled' ? await transpileService() : undefined;
  const output: string[] = [];
  const child = spawn(
    process.execPath,
    buildDirectory === undefined
      ? ['--import', 'tsx', '--import', './src/infrastructure/observability/instrumentation.ts', 'src/index.ts']
      : ['--import', './src/infrastructure/observability/instrumentation.js', 'src/index.js'],
    {
      cwd: buildDirectory ?? repositoryRoot,
      env: { ...process.env, ...options.env, HOST: '127.0.0.1', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  const stop = async (): Promise<void> => {
    await stopChild(child);
    if (buildDirectory !== undefined) {
      await rm(buildDirectory, { recursive: true, force: true });
    }
  };

  try {
    const url = await waitForListeningUrl(child, output, options.startupTimeoutMs ?? 30_000);
    return { url, child, output: () => output.join(''), stop };
  } catch (error) {
    await stop();
    throw new Error(`Service did not start.\nService output:\n${output.join('')}`, { cause: error });
  }
}

/** One isolated build per call: concurrent test files never share or race on output. */
async function transpileService(): Promise<string> {
  await mkdir(buildParentDirectory, { recursive: true });
  // Inside node_modules so the child resolves dependencies from the repository root.
  const buildDirectory = await mkdtemp(join(buildParentDirectory, 'service-'));
  const sourceFiles = await listTypeScriptFiles(join(repositoryRoot, 'src'));
  await Promise.all(
    sourceFiles.map(async (sourceFile) => {
      const { code } = await transformFile(sourceFile, swcOptions);
      const outputFile = join(buildDirectory, relative(repositoryRoot, sourceFile)).replace(/\.ts$/, '.js');
      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(outputFile, code);
    }),
  );
  // src/service-metadata.ts imports ../package.json.
  await copyFile(join(repositoryRoot, 'package.json'), join(buildDirectory, 'package.json'));
  return buildDirectory;
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Readiness comes from the URL the service prints after `listen`, so PORT=0 needs no port reservation. */
async function waitForListeningUrl(child: ChildProcess, output: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('exit', onExit);
    };
    const onData = (): void => {
      const match = output.join('').match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1] !== undefined) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`service exited before listening (code ${String(code)}, signal ${String(signal)})`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`service did not print its listening URL within ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.once('exit', onExit);
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  const escalation = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.kill('SIGTERM');
  try {
    await exited;
  } finally {
    clearTimeout(escalation);
  }
}
