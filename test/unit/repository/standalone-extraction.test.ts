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
const standaloneSurfaces = [
  'docker-compose.yml',
  'DEVELOPMENT.md',
  'README.md',
  'src/service-metadata.ts',
] as const;

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
});

function readTextFile(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
}

function readJsonFile<T>(relativePath: string): T {
  return JSON.parse(readTextFile(relativePath)) as T;
}
