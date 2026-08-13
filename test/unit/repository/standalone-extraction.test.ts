import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly name?: unknown;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly workspaces?: unknown;
}

interface PackageLock {
  readonly name?: unknown;
  readonly packages?: Readonly<Record<string, { readonly name?: unknown }>>;
}

const repositoryRoot = process.cwd();
const standaloneSurfaces = ['docker-compose.yml', 'DEVELOPMENT.md', 'README.md', 'src/service-metadata.ts'] as const;

describe('standalone repository extraction contract', () => {
  it('uses one root package and lockfile without workspace-scoped scripts', () => {
    const packageManifest = readJsonFile<PackageManifest>('package.json');
    const packageLock = readJsonFile<PackageLock>('package-lock.json');
    const scripts = Object.values(packageManifest.scripts ?? {}).join('\n');

    expect(packageManifest.name).toBe('movie-reservation-service');
    expect(packageManifest.workspaces).toBeUndefined();
    expect(packageLock.name).toBe(packageManifest.name);
    expect(packageLock.packages?.['']?.name).toBe(packageManifest.name);
    expect(scripts).not.toMatch(/(?:^|\s)npm\s+(?:-w|--workspace)(?:\s|=)/);
    expect(scripts).not.toContain('../node_modules');
  });

  it.each(standaloneSurfaces)('%s keeps paths relative to this repository root', (relativePath) => {
    const contents = readTextFile(relativePath);

    expect(contents).not.toMatch(/npm\s+(?:-w|--workspace)(?:\s|=)/);
    expect(contents).not.toContain('../node_modules');
    expect(contents).not.toContain('movie-reservation-service/env_files');
    expect(contents).not.toContain('/workspace/movie-reservation-service');
  });

  it('builds the Compose API from the standalone repository context', () => {
    const compose = readTextFile('docker-compose.yml');

    expect(compose).toMatch(/build:\s*\n\s+context: \.\s*\n\s+dockerfile: Dockerfile/);
    expect(compose).toContain('./env_files/templates/in-docker/local-postgres.env.template');
    expect(compose).toContain('./observability/otel-collector.yaml');
    expect(compose).not.toContain('golden-path-movie-reservations');
  });

  it('keeps every Compose-published port on the loopback interface', () => {
    const compose = readTextFile('docker-compose.yml');

    expect(compose).toContain("'127.0.0.1:5432:5432'");
    expect(compose).toContain("'127.0.0.1:14317:4317'");
    expect(compose).toContain("'127.0.0.1:14318:4318'");
    expect(compose).toContain("'127.0.0.1:18889:8889'");
    expect(compose).toContain("'127.0.0.1:${MOVIE_RESERVATION_API_HOST_PORT:-3001}:3000'");
  });

  it('keeps hosted CI focused, pinned, and non-publishing', () => {
    const workflow = readTextFile('.github/workflows/ci.yml');
    const expectedJobs = [
      'service-quality',
      'service-unit-tests',
      'service-integration-tests',
      'service-build',
      'container-image-check',
    ] as const;
    const actionReferences = [...workflow.matchAll(/^\s+uses:\s+(\S+)/gm)].map((match) => match[1]);
    const allowedActionReferences = [
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
    ] as const;

    expect(workflow).toMatch(/^name: CI$/m);

    for (const job of expectedJobs) {
      expect(readWorkflowJob(workflow, job)).toMatch(new RegExp(`^ {4}name: ${job}$`, 'm'));
    }

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const actionReference of actionReferences) {
      expect(actionReference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      expect(allowedActionReferences).toContain(actionReference);
    }

    expect(workflow).toContain('run: npm run format:check');
    expect(workflow).toContain('run: npm run lint');
    expect(workflow).toContain('run: npm run typecheck');
    expect(workflow).toContain('run: npm run test:unit');
    expect(workflow).toContain('run: npm run test:integration');
    expect(workflow).toContain('run: npm run build');
    expect(workflow).toContain('run: npm run docker:build');
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents: read$/m);
    expect(workflow).not.toContain('pull_request_target:');
    expect(workflow).not.toMatch(/run:\s+npm run (?:check|ci|test:e2e)\b/);
    expect(workflow).not.toMatch(/^\s+[a-z-]+:\s+write$/m);
    expect(workflow).not.toMatch(/docker\s+login|--push|publish-candidate/);

    for (const job of ['service-unit-tests', 'service-integration-tests', 'service-build'] as const) {
      expect(readWorkflowJob(workflow, job)).toMatch(/^ {4}needs:\s*\n {6}- service-quality$/m);
    }

    const containerImageJob = readWorkflowJob(workflow, 'container-image-check');
    expect(containerImageJob).toContain('DOCKER_DEFAULT_PLATFORM: linux/amd64');
    for (const prerequisite of expectedJobs.slice(0, -1)) {
      expect(containerImageJob).toContain(`- ${prerequisite}`);
    }
  });
});

function readTextFile(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
}

function readJsonFile<T>(relativePath: string): T {
  return JSON.parse(readTextFile(relativePath)) as T;
}

function readWorkflowJob(workflow: string, job: string): string {
  const startMarker = `  ${job}:\n`;
  const start = workflow.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  const jobAndRemainder = workflow.slice(start + startMarker.length);
  const nextJob = jobAndRemainder.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);

  return nextJob === -1 ? jobAndRemainder : jobAndRemainder.slice(0, nextJob);
}
