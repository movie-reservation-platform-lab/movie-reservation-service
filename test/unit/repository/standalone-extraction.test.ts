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

  it('keeps hosted CI focused and pins every external action to an approved commit', () => {
    const workflow = readTextFile('.github/workflows/ci.yml');
    const serviceJobs = [
      'service-quality',
      'service-unit-tests',
      'service-integration-tests',
      'service-build',
    ] as const;
    const expectedJobs = [...serviceJobs, 'container-image-check', 'publish-candidate'] as const;
    const actionReferences = [...workflow.matchAll(/^\s+uses:\s+(\S+)/gm)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    const allowedExternalActionReferences = [
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
      'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
      'docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9',
      'docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8',
      'actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a',
    ] as const;
    const allowedLocalActionReferences = [
      './.github/actions/prepare-container-candidate',
      './.github/actions/record-container-candidate',
    ] as const;
    const localActionReferences = actionReferences.filter((reference) => reference.startsWith('./'));
    const externalActionReferences = actionReferences.filter((reference) => !reference.startsWith('./'));

    expect(workflow).toMatch(/^name: CI$/m);

    for (const job of expectedJobs) {
      expect(readWorkflowJob(workflow, job)).toMatch(new RegExp(`^ {4}name: ${job}$`, 'm'));
    }

    expect(actionReferences.length).toBeGreaterThan(0);
    expect(localActionReferences).toEqual(allowedLocalActionReferences);
    for (const actionReference of externalActionReferences) {
      expect(actionReference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      expect(allowedExternalActionReferences).toContain(actionReference);
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
    expect(workflow).not.toContain(':latest');
    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}-${{ github.event_name }}');
    expect(workflow).not.toContain('cancel-in-progress: true');
    expect(workflow).toMatch(
      /cancel-in-progress:[\s\S]*?github\.repository != 'movie-reservation-platform-lab\/movie-reservation-service'/,
    );

    for (const job of ['service-unit-tests', 'service-integration-tests', 'service-build'] as const) {
      expect(readWorkflowJob(workflow, job)).toMatch(/^ {4}needs:\s*\n {6}- service-quality$/m);
    }

    const containerImageJob = readWorkflowJob(workflow, 'container-image-check');
    expect(containerImageJob).toContain('DOCKER_DEFAULT_PLATFORM: linux/amd64');
    expect(containerImageJob).toContain("github.event_name != 'push'");
    expect(containerImageJob).toContain("github.ref != 'refs/heads/main'");
    expect(containerImageJob).toContain(
      "github.repository != 'movie-reservation-platform-lab/movie-reservation-service'",
    );
    expect(containerImageJob).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(containerImageJob).not.toMatch(/^\s+[a-z-]+:\s+write$/m);
    expect(containerImageJob).not.toMatch(/docker\/login-action|docker\/build-push-action|push: true/);
    for (const prerequisite of serviceJobs) {
      expect(containerImageJob).toContain(`- ${prerequisite}`);
    }
  });

  it('publishes and attests candidates only for the canonical main branch', () => {
    const workflow = readTextFile('.github/workflows/ci.yml');
    const publisher = readWorkflowJob(workflow, 'publish-candidate');
    const serviceJobs = [
      'service-quality',
      'service-unit-tests',
      'service-integration-tests',
      'service-build',
    ] as const;

    expect(publisher).toContain("github.event_name == 'push'");
    expect(publisher).toContain("github.ref == 'refs/heads/main'");
    expect(publisher).toContain("github.repository == 'movie-reservation-platform-lab/movie-reservation-service'");
    for (const prerequisite of serviceJobs) {
      expect(publisher).toContain(`- ${prerequisite}`);
    }

    expect(publisher).toMatch(
      /permissions:\s*\n\s+contents: read\s*\n\s+packages: write\s*\n\s+id-token: write\s*\n\s+attestations: write/,
    );
    const writePermissions = [...workflow.matchAll(/^\s+([a-z-]+): write$/gm)].map((match) => match[1]);
    expect(writePermissions).toEqual(['packages', 'id-token', 'attestations']);
    expect(publisher).toContain('persist-credentials: false');
    expect(publisher).toContain('uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9');
    expect(publisher).toContain('uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8');
    expect(publisher).toContain('uses: actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a');
    expect(publisher).toContain('uses: ./.github/actions/prepare-container-candidate');
    expect(publisher).toContain('uses: ./.github/actions/record-container-candidate');
    expect(publisher).toContain('expected-repository: movie-reservation-platform-lab/movie-reservation-service');
    expect(publisher).toContain('expected-ref: refs/heads/main');
    expect(publisher).toContain('platforms: linux/amd64');
    expect(publisher).toContain('push: true');
    expect(publisher).toContain('org.opencontainers.image.source=');
    expect(publisher).toContain('org.opencontainers.image.revision=');
    expect(publisher).toContain('org.opencontainers.image.version=');
    expect(publisher).toContain('subject-digest: ${{ steps.publish.outputs.digest }}');
    expect(publisher).toContain('push-to-registry: false');
    expect(publisher).not.toContain('push-to-registry: true');
    expect(publisher).toContain('candidate-digest: ${{ steps.publish.outputs.digest }}');
    expect(publisher).toContain('source-revision: ${{ github.sha }}');
    expect(publisher).not.toMatch(/^\s+run:\s+\|/m);
  });

  it('exposes script-backed local actions through explicit publication contracts', () => {
    const prepareAction = readTextFile('.github/actions/prepare-container-candidate/action.yml');
    const recordAction = readTextFile('.github/actions/record-container-candidate/action.yml');

    expect(prepareAction).toContain('using: composite');
    expect(prepareAction).toContain('expected-repository:');
    expect(prepareAction).toContain('expected-ref:');
    for (const output of ['registry', 'repository', 'image_ref', 'tag', 'build_ref'] as const) {
      expect(prepareAction).toContain(`value: \${{ steps.prepare.outputs.${output} }}`);
    }
    expect(prepareAction).toContain('run: bash "${{ github.action_path }}/prepare.sh"');

    expect(recordAction).toContain('using: composite');
    for (const input of [
      'artifact-name',
      'candidate-registry',
      'candidate-repository',
      'candidate-image',
      'candidate-tag',
      'candidate-digest',
      'source-repository',
      'source-revision',
      'build-ref',
    ] as const) {
      expect(recordAction).toContain(`${input}:`);
    }
    expect(recordAction).toContain('value: ${{ steps.record.outputs.immutable_candidate }}');
    expect(recordAction).toContain('run: bash "${{ github.action_path }}/record.sh"');
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
