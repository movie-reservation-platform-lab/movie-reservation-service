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

describe('repository and CI automation contract', () => {
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

  it('keeps repository automation outside service test discovery', () => {
    const packageManifest = readJsonFile<PackageManifest>('package.json');
    const serviceVitestConfig = readTextFile('vitest.config.ts');
    const automationVitestConfig = readTextFile('automation/vitest.config.ts');

    expect(packageManifest.scripts?.['test:unit']).toBe('vitest run test/unit');
    expect(packageManifest.scripts?.['test:integration']).toBe('vitest run test/integration');
    expect(packageManifest.scripts?.['test:automation']).toBe('vitest run --config automation/vitest.config.ts');
    expect(serviceVitestConfig).toContain("include: ['test/**/*.test.ts']");
    expect(serviceVitestConfig).not.toContain('automation/');
    expect(automationVitestConfig).toContain("include: ['automation/**/test/**/*.test.ts']");
    expect(automationVitestConfig).not.toContain("include: ['test/**/*.test.ts']");
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
    expect(compose).toContain('target: runtime-debug');
    expect(compose).toContain('./env_files/templates/in-docker/local-postgres.env.template');
    expect(compose).toContain('./observability/otel-collector.yaml');
    expect(compose).not.toContain('golden-path-movie-reservations');
  });

  it('separates the pinned debuggable image from the non-root production runtime', () => {
    const dockerfile = readTextFile('Dockerfile');
    const packageManifest = readJsonFile<PackageManifest>('package.json');
    const nodeBuildImage =
      'node:24-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d';
    const distrolessRuntimeImage =
      'gcr.io/distroless/nodejs24-debian13:nonroot@sha256:fbbdda866ea71aef98c4abece17e3d61fbf820cc2ef3961522caa2478716171a';
    const debugStageStart = dockerfile.indexOf('FROM ${NODE_BUILD_IMAGE} AS runtime-debug');
    const runtimeStageStart = dockerfile.indexOf('FROM ${NODE_RUNTIME_IMAGE} AS runtime');
    const debugStage = dockerfile.slice(debugStageStart, runtimeStageStart);
    const runtimeStage = dockerfile.slice(runtimeStageStart);

    expect(dockerfile).toContain(`ARG NODE_BUILD_IMAGE=${nodeBuildImage}`);
    expect(dockerfile).toContain(`ARG NODE_RUNTIME_IMAGE=${distrolessRuntimeImage}`);
    expect(debugStageStart).toBeGreaterThanOrEqual(0);
    expect(runtimeStageStart).toBeGreaterThan(debugStageStart);
    expect(debugStage).toContain('USER node');
    expect(debugStage).toContain('CMD ["node", "--import"');
    expect(runtimeStage).toContain('USER nonroot:nonroot');
    expect(runtimeStage).toContain('COPY --from=runtime-layout --chown=nonroot:nonroot');
    expect(runtimeStage).toContain('CMD ["--import"');
    expect(runtimeStage).not.toContain('npm run start');
    expect(packageManifest.scripts?.['docker:build']).toContain('--target runtime');
    expect(packageManifest.scripts?.['docker:build:debug']).toContain('--target runtime-debug');
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
    const expectedJobs = [
      ...serviceJobs,
      'automation-quality',
      'container-security-check',
      'publish-candidate',
    ] as const;
    const actionReferences = [...workflow.matchAll(/^\s+uses:\s+(\S+)/gm)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    const allowedExternalActionReferences = [
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
      'movie-reservation-platform-lab/movie-platform-actions/actions/prepare-container-candidate@388507380ae9bc2b1ac91282ff16f40d4c65fcfc',
      'movie-reservation-platform-lab/movie-platform-actions/actions/container-evidence@388507380ae9bc2b1ac91282ff16f40d4c65fcfc',
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
      'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
      'docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9',
      'docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8',
      'actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a',
    ] as const;
    const allowedLocalActionReferences: readonly string[] = [];
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
    expect(workflow).toContain('run: npm run typecheck:automation');
    expect(workflow).toContain('run: npm run test:automation');
    expect(workflow).toContain('run: npm run build');
    expect(workflow).toContain('docker build --platform linux/amd64 --target runtime');
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

    const automationJob = readWorkflowJob(workflow, 'automation-quality');
    expect(automationJob).toContain('run: npm run typecheck:automation');
    expect(automationJob).toContain('run: npm run test:automation');
    expect(automationJob).not.toContain('run: npm run test:unit');
    expect(automationJob).not.toContain('run: npm run test:integration');

    const containerSecurityJob = readWorkflowJob(workflow, 'container-security-check');
    expect(containerSecurityJob).toContain('--platform linux/amd64');
    expect(containerSecurityJob).toContain("github.event_name != 'push'");
    expect(containerSecurityJob).toContain("github.ref != 'refs/heads/main'");
    expect(containerSecurityJob).toContain(
      "github.repository != 'movie-reservation-platform-lab/movie-reservation-service'",
    );
    expect(containerSecurityJob).toMatch(/^ {4}needs:\s*\n {6}- automation-quality\s*\n {6}- service-quality$/m);
    expect(containerSecurityJob).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(containerSecurityJob).not.toMatch(/^\s+[a-z-]+:\s+write$/m);
    expect(containerSecurityJob).not.toMatch(/docker\/login-action|docker\/build-push-action|push: true/);
    for (const unrelatedJob of ['service-unit-tests', 'service-integration-tests', 'service-build'] as const) {
      expect(containerSecurityJob).not.toContain(`- ${unrelatedJob}`);
    }
  });

  it('uses the same immutable shared policy tooling for PRs and canonical publication', () => {
    const workflow = readTextFile('.github/workflows/ci.yml');
    const security = readWorkflowJob(workflow, 'container-security-check');
    const pin = '388507380ae9bc2b1ac91282ff16f40d4c65fcfc';
    expect(security).toContain(`ref: ${pin}`);
    expect(security).toContain('persist-credentials: false');
    expect(security).toContain('node .platform-actions/local-tools/container-security/lib/scan.mjs');
    expect(security).toContain('--evidence-version v1alpha3 --component reservation-service');
    expect(security).toContain('GH_TOKEN: ${{ github.token }}');
    expect(security).toContain('--target runtime --tag movie-reservation-service:local');
    expect(security).toContain('if: ${{ !cancelled() }}');
    expect(security).toContain('path: ${{ runner.temp }}/reservation-service-pr-security/');
    expect(security).toContain('retention-days: 14');
    expect(security.indexOf('docker build')).toBeLessThan(security.indexOf('node .platform-actions'));
    expect(security.indexOf('node .platform-actions')).toBeLessThan(security.indexOf('uses: actions/upload-artifact'));
    expect(workflow).not.toContain('uses: ./.github/actions/');
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
    expect(publisher).toContain('- automation-quality');

    expect(publisher).toMatch(
      /permissions:\s*\n\s+contents: read\s*\n\s+packages: write\s*\n\s+id-token: write\s*\n\s+attestations: write/,
    );
    const writePermissions = [...workflow.matchAll(/^\s+([a-z-]+): write$/gm)].map((match) => match[1]);
    expect(writePermissions).toEqual(['packages', 'id-token', 'attestations']);
    expect(publisher).toContain('persist-credentials: false');
    expect(publisher).toContain('uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9');
    expect(publisher).toContain('uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8');
    const buildPushStart = publisher.indexOf('uses: docker/build-push-action@');
    const buildPushEnd = publisher.indexOf('\n      - name:', buildPushStart);
    const buildPushStep = publisher.slice(buildPushStart, buildPushEnd);
    expect(buildPushStep).toContain('platforms: linux/amd64');
    expect(buildPushStep.match(/^\s+provenance: false$/gm)).toHaveLength(1);
    expect(buildPushStep).not.toMatch(/^\s+(?:attests|sbom):/gm);
    expect(buildPushStep).toContain('push: true');
    expect(publisher).toContain('org.opencontainers.image.source=');
    expect(publisher).toContain('org.opencontainers.image.revision=');
    expect(publisher).toContain('org.opencontainers.image.version=');
    expect(publisher).not.toContain('push-to-registry: true');
    expect(publisher).toContain('github-token: ${{ github.token }}');
    expect(publisher).toContain('node-version-file: .nvmrc');
    expect(publisher).not.toMatch(/^\s+run:\s+npm\b/m);
    expect(publisher).not.toMatch(/^\s+run:\s+\|/m);
  });

  it('binds v3 evidence to the published digest with authenticated preparation', () => {
    const publisher = readWorkflowJob(readTextFile('.github/workflows/ci.yml'), 'publish-candidate');
    const shared = 'movie-reservation-platform-lab/movie-platform-actions/actions/';
    const pin = '388507380ae9bc2b1ac91282ff16f40d4c65fcfc';
    expect(publisher).toContain(`uses: ${shared}prepare-container-candidate@${pin}`);
    expect(publisher).toContain(`uses: ${shared}container-evidence@${pin}`);
    expect(publisher.match(/evidence-version: v1alpha3/g)).toHaveLength(1);
    expect(publisher.match(/component: reservation-service/g)).toHaveLength(2);
    expect(publisher.match(/github-token: \$\{\{ github.token \}\}/g)).toHaveLength(2);
    expect(publisher).toContain('digest: ${{ steps.publish.outputs.digest }}');
    expect(publisher).toContain('target: runtime');
    expect(publisher.indexOf('prepare-container-candidate@')).toBeLessThan(publisher.indexOf('docker/login-action@'));
    expect(publisher.indexOf('docker/build-push-action@')).toBeLessThan(publisher.indexOf('container-evidence@'));
    expect(publisher).not.toContain('v1alpha1');
    expect(publisher).not.toContain('automation/candidate-evidence');
  });

  it('exposes script-backed local actions through explicit workflow contracts', () => {
    const evaluateAction = readTextFile('.github/actions/evaluate-container-vulnerabilities/action.yml');
    const prepareAction = readTextFile('.github/actions/prepare-container-candidate/action.yml');
    const recordAction = readTextFile('.github/actions/record-container-candidate/action.yml');
    const verifyProvenanceAction = readTextFile('.github/actions/verify-container-provenance/action.yml');

    expect(evaluateAction).toContain('using: composite');
    for (const input of ['report-path', 'expected-image', 'subject-kind', 'evidence-artifact-name'] as const) {
      expect(evaluateAction).toContain(`${input}:`);
    }
    for (const output of ['high-count', 'critical-count', 'policy-result'] as const) {
      expect(evaluateAction).toContain(`value: \${{ steps.evaluate.outputs.${output} }}`);
    }
    expect(evaluateAction).toContain(
      'run: node "${{ github.action_path }}/../../../automation/container-security/src/evaluate.mjs"',
    );

    expect(prepareAction).toContain('using: composite');
    expect(prepareAction).toContain('expected-repository:');
    expect(prepareAction).toContain('expected-ref:');
    for (const output of ['registry', 'repository', 'image_ref', 'tag', 'build_ref'] as const) {
      expect(prepareAction).toContain(`value: \${{ steps.prepare.outputs.${output} }}`);
    }
    expect(prepareAction).toContain(
      'run: bash "${{ github.action_path }}/../../../automation/candidate-publication/src/prepare.sh"',
    );

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
      'evidence-artifact-name',
      'evidence-contract-path',
      'evidence-attestation-url',
    ] as const) {
      expect(recordAction).toContain(`${input}:`);
    }
    expect(recordAction).toContain('value: ${{ steps.record.outputs.immutable_candidate }}');
    expect(recordAction).toContain('value: ${{ steps.record.outputs.evidence_artifact_name }}');
    expect(recordAction).toContain('value: ${{ steps.record.outputs.evidence_contract_path }}');
    expect(recordAction).toContain('value: ${{ steps.record.outputs.evidence_attestation_url }}');
    expect(recordAction).toContain(
      'run: bash "${{ github.action_path }}/../../../automation/candidate-publication/src/record.sh"',
    );

    expect(verifyProvenanceAction).toContain('using: composite');
    for (const input of ['bundle-path', 'candidate-image', 'github-token', 'source-revision'] as const) {
      expect(verifyProvenanceAction).toContain(`${input}:`);
    }
    expect(verifyProvenanceAction).toContain(
      'run: bash "${{ github.action_path }}/../../../automation/candidate-publication/src/verify-provenance.sh"',
    );
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
