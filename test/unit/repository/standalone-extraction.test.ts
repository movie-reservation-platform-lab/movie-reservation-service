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
    const expectedJobs = [...serviceJobs, 'container-security-check', 'publish-candidate'] as const;
    const actionReferences = [...workflow.matchAll(/^\s+uses:\s+(\S+)/gm)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    const allowedExternalActionReferences = [
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
      'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25',
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
      'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
      'docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9',
      'docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8',
      'actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a',
    ] as const;
    const allowedLocalActionReferences = [
      './.github/actions/evaluate-container-vulnerabilities',
      './.github/actions/prepare-container-candidate',
      './.github/actions/evaluate-container-vulnerabilities',
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

    const containerSecurityJob = readWorkflowJob(workflow, 'container-security-check');
    expect(containerSecurityJob).toContain('DOCKER_DEFAULT_PLATFORM: linux/amd64');
    expect(containerSecurityJob).toContain("github.event_name != 'push'");
    expect(containerSecurityJob).toContain("github.ref != 'refs/heads/main'");
    expect(containerSecurityJob).toContain(
      "github.repository != 'movie-reservation-platform-lab/movie-reservation-service'",
    );
    expect(containerSecurityJob).toMatch(/^ {4}needs:\s*\n {6}- service-quality$/m);
    expect(containerSecurityJob).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(containerSecurityJob).not.toMatch(/^\s+[a-z-]+:\s+write$/m);
    expect(containerSecurityJob).not.toMatch(/docker\/login-action|docker\/build-push-action|push: true/);
    for (const unrelatedJob of ['service-unit-tests', 'service-integration-tests', 'service-build'] as const) {
      expect(containerSecurityJob).not.toContain(`- ${unrelatedJob}`);
    }
  });

  it('scans the local PR image and retains complete JSON evidence', () => {
    const workflow = readTextFile('.github/workflows/ci.yml');
    const containerSecurityJob = readWorkflowJob(workflow, 'container-security-check');
    const localImage = 'movie-reservation-service:local';
    const reportPath = 'security-evidence/reservation-service-vulnerabilities.json';

    expect(containerSecurityJob).toContain('run: npm run docker:build');
    expect(containerSecurityJob).toContain('uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
    expect(containerSecurityJob).toContain('scan-type: image');
    expect(containerSecurityJob).toContain(`image-ref: ${localImage}`);
    expect(containerSecurityJob).toContain('scanners: vuln');
    expect(containerSecurityJob).toContain('vuln-type: os,library');
    expect(containerSecurityJob).toContain('format: json');
    expect(containerSecurityJob).toContain(`output: ${reportPath}`);
    expect(containerSecurityJob).toContain('severity: UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL');
    expect(containerSecurityJob).toContain('ignore-unfixed: false');
    expect(containerSecurityJob).toContain("exit-code: '0'");
    expect(containerSecurityJob).toContain('timeout: 5m');
    expect(containerSecurityJob).toContain('uses: ./.github/actions/evaluate-container-vulnerabilities');
    expect(containerSecurityJob).toContain(`report-path: ${reportPath}`);
    expect(containerSecurityJob).toContain(`expected-image: ${localImage}`);
    expect(containerSecurityJob).toContain('subject-kind: local');
    expect(containerSecurityJob).toContain('uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(containerSecurityJob).toContain('if: ${{ !cancelled() }}');
    expect(containerSecurityJob).toContain(`path: ${reportPath}`);
    expect(containerSecurityJob).toContain('if-no-files-found: error');
    expect(containerSecurityJob).toContain('retention-days: 14');
    expect(containerSecurityJob).not.toMatch(/cyclonedx|sbom/i);

    const buildIndex = containerSecurityJob.indexOf('run: npm run docker:build');
    const scanIndex = containerSecurityJob.indexOf('uses: aquasecurity/trivy-action@');
    const evaluationIndex = containerSecurityJob.indexOf('uses: ./.github/actions/evaluate-container-vulnerabilities');
    const uploadIndex = containerSecurityJob.indexOf('uses: actions/upload-artifact@');

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(scanIndex).toBeGreaterThan(buildIndex);
    expect(evaluationIndex).toBeGreaterThan(scanIndex);
    expect(uploadIndex).toBeGreaterThan(evaluationIndex);
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
    expect(publisher).toContain('uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
    expect(publisher).toContain('uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(publisher).toContain('uses: ./.github/actions/prepare-container-candidate');
    expect(publisher).toContain('uses: ./.github/actions/evaluate-container-vulnerabilities');
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

  it('records exact-digest security evidence before making the candidate eligible', () => {
    const workflow = readTextFile('.github/workflows/ci.yml');
    const publisher = readWorkflowJob(workflow, 'publish-candidate');
    const immutableCandidate = '${{ steps.image.outputs.image_ref }}@${{ steps.publish.outputs.digest }}';
    const trivyAction = 'uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25';
    const uploadAction = 'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
    const evaluatorAction = 'uses: ./.github/actions/evaluate-container-vulnerabilities';
    const handoffAction = 'uses: ./.github/actions/record-container-candidate';

    expect(publisher.match(new RegExp(escapeRegExp(trivyAction), 'g'))).toHaveLength(2);
    expect(publisher.match(new RegExp(escapeRegExp(`image-ref: ${immutableCandidate}`), 'g'))).toHaveLength(2);
    expect(publisher.match(/scanners: vuln/g)).toHaveLength(2);
    expect(publisher.match(/vuln-type: os,library/g)).toHaveLength(2);
    expect(publisher.match(/ignore-unfixed: false/g)).toHaveLength(2);
    expect(publisher.match(/exit-code: '0'/g)).toHaveLength(2);
    expect(publisher.match(/timeout: 5m/g)).toHaveLength(2);
    expect(publisher).toContain('format: cyclonedx');
    expect(publisher).toContain('list-all-pkgs: true');
    expect(publisher).toContain('output: security-evidence/reservation-service.cdx.json');
    expect(publisher).toContain('format: json');
    expect(publisher).toContain('severity: UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL');
    expect(publisher).toContain('output: security-evidence/reservation-service-vulnerabilities.json');
    expect(publisher).toContain('version: v0.70.0');
    expect(publisher).toContain('skip-setup-trivy: true');
    expect(publisher).toContain('cache: false');
    expect(publisher).toContain(`expected-image: ${immutableCandidate}`);
    expect(publisher).toContain('subject-kind: immutable-ghcr');
    expect(publisher).toContain(
      'reservation-service-security-evidence-${{ github.run_id }}-attempt-${{ github.run_attempt }}',
    );
    expect(publisher).toContain('if: ${{ !cancelled() }}');
    expect(publisher).toContain('if-no-files-found: error');
    expect(publisher).toContain('retention-days: 14');

    const publishPosition = publisher.indexOf('uses: docker/build-push-action@');
    const attestationPosition = publisher.indexOf('uses: actions/attest-build-provenance@');
    const firstScanPosition = publisher.indexOf(trivyAction);
    const evaluationPosition = publisher.indexOf(evaluatorAction);
    const uploadPosition = publisher.indexOf(uploadAction);
    const handoffPosition = publisher.indexOf(handoffAction);

    expect(publishPosition).toBeGreaterThanOrEqual(0);
    expect(attestationPosition).toBeGreaterThan(publishPosition);
    expect(firstScanPosition).toBeGreaterThan(attestationPosition);
    expect(evaluationPosition).toBeGreaterThan(firstScanPosition);
    expect(uploadPosition).toBeGreaterThan(evaluationPosition);
    expect(handoffPosition).toBeGreaterThan(uploadPosition);
  });

  it('exposes script-backed local actions through explicit workflow contracts', () => {
    const evaluateAction = readTextFile('.github/actions/evaluate-container-vulnerabilities/action.yml');
    const prepareAction = readTextFile('.github/actions/prepare-container-candidate/action.yml');
    const recordAction = readTextFile('.github/actions/record-container-candidate/action.yml');

    expect(evaluateAction).toContain('using: composite');
    for (const input of ['report-path', 'expected-image', 'subject-kind', 'evidence-artifact-name'] as const) {
      expect(evaluateAction).toContain(`${input}:`);
    }
    for (const output of ['high-count', 'critical-count', 'policy-result'] as const) {
      expect(evaluateAction).toContain(`value: \${{ steps.evaluate.outputs.${output} }}`);
    }
    expect(evaluateAction).toContain('run: node "${{ github.action_path }}/evaluate.mjs"');

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
