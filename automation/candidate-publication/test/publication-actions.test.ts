import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const prepareScript = join(repositoryRoot, 'automation', 'candidate-publication', 'src', 'prepare.sh');
const recordScript = join(repositoryRoot, 'automation', 'candidate-publication', 'src', 'record.sh');
const sourceRevision = 'a'.repeat(40);
const imageDigest = `sha256:${'b'.repeat(64)}`;
const sourceRepository = 'movie-reservation-platform-lab/movie-reservation-service';
const runId = '123456789';
const runAttempt = '2';
const evidenceArtifactName = `reservation-service-security-evidence-${runId}-attempt-${runAttempt}`;
const evidenceContractPath = 'security-evidence/component-candidate-evidence-v1alpha1.json';
const evidenceAttestationUrl = `https://github.com/${sourceRepository}/attestations/246813579`;

let temporaryDirectory = '';

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'reservation-ci-actions-'));
});

afterEach(() => {
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe('prepare-container-candidate', () => {
  it('resolves attempt-unique metadata after confirming the canonical ref', () => {
    const githubOutput = createEmptyFile('prepare-output');
    const gitCalls = join(temporaryDirectory, 'git-calls');
    const fakeBin = createFakeGit();

    const result = runScript(prepareScript, {
      ...basePrepareEnvironment(githubOutput),
      FAKE_GIT_CALLS: gitCalls,
      FAKE_REMOTE_SHA: sourceRevision,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readKeyValueFile(githubOutput)).toEqual({
      build_ref: `https://github.com/${sourceRepository}/actions/runs/${runId}/attempts/${runAttempt}`,
      image_ref: `ghcr.io/${sourceRepository}`,
      registry: 'ghcr.io',
      repository: sourceRepository,
      tag: `sha-${sourceRevision}-run-${runId}-attempt-${runAttempt}`,
    });
    expect(readFileSync(gitCalls, 'utf8')).toBe(
      `ls-remote --exit-code https://github.com/${sourceRepository}.git refs/heads/main\n`,
    );
  });

  it('rejects a stale source revision before returning candidate metadata', () => {
    const githubOutput = createEmptyFile('stale-output');
    const fakeBin = createFakeGit();

    const result = runScript(prepareScript, {
      ...basePrepareEnvironment(githubOutput),
      FAKE_GIT_CALLS: join(temporaryDirectory, 'stale-git-calls'),
      FAKE_REMOTE_SHA: 'c'.repeat(40),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Refusing to publish stale revision ${sourceRevision}`);
    expect(readFileSync(githubOutput, 'utf8')).toBe('');
  });

  it('rejects non-push events without querying the remote repository', () => {
    const githubOutput = createEmptyFile('pull-request-output');
    const gitCalls = join(temporaryDirectory, 'pull-request-git-calls');
    const fakeBin = createFakeGit();

    const result = runScript(prepareScript, {
      ...basePrepareEnvironment(githubOutput),
      FAKE_GIT_CALLS: gitCalls,
      FAKE_REMOTE_SHA: sourceRevision,
      GITHUB_EVENT_NAME: 'pull_request',
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Container candidates may only be prepared for push events');
    expect(existsSync(gitCalls)).toBe(false);
    expect(readFileSync(githubOutput, 'utf8')).toBe('');
  });
});

describe('record-container-candidate', () => {
  it('records the digest-pinned candidate and official provenance command', () => {
    const githubOutput = createEmptyFile('record-output');
    const stepSummary = createEmptyFile('record-summary');
    const candidateImage = `ghcr.io/${sourceRepository}`;
    const immutableCandidate = `${candidateImage}@${imageDigest}`;

    const result = runScript(recordScript, baseRecordEnvironment(githubOutput, stepSummary));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readKeyValueFile(githubOutput)).toEqual({
      evidence_artifact_name: evidenceArtifactName,
      evidence_attestation_url: evidenceAttestationUrl,
      evidence_contract_path: evidenceContractPath,
      immutable_candidate: immutableCandidate,
    });
    expect(readFileSync(stepSummary, 'utf8')).toBe(
      [
        '### Published reservation-service candidate',
        '',
        '- Candidate registry: `ghcr.io`',
        `- Candidate repository: \`${sourceRepository}\``,
        `- Candidate tag: \`${candidateImage}:sha-${sourceRevision}-run-${runId}-attempt-${runAttempt}\``,
        `- Immutable candidate: \`${immutableCandidate}\``,
        `- Source repository: \`${sourceRepository}\``,
        `- Source revision: \`${sourceRevision}\``,
        `- Build reference: https://github.com/${sourceRepository}/actions/runs/${runId}/attempts/${runAttempt}`,
        `- Evidence artifact: \`${evidenceArtifactName}\``,
        `- Evidence contract: \`${evidenceContractPath}\``,
        `- Evidence package attestation: ${evidenceAttestationUrl}`,
        '',
        'After authenticating to GHCR, verify provenance with:',
        `\`gh attestation verify oci://${immutableCandidate} --repo ${sourceRepository}\``,
        '',
        'Only the immutable digest, not the discovery tag, is eligible for downstream admission.',
        '',
      ].join('\n'),
    );
  });

  it('rejects an invalid digest without recording a handoff', () => {
    const githubOutput = createEmptyFile('invalid-digest-output');
    const stepSummary = createEmptyFile('invalid-digest-summary');

    const result = runScript(recordScript, {
      ...baseRecordEnvironment(githubOutput, stepSummary),
      CANDIDATE_DIGEST: 'sha256:not-a-digest',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Build action returned an invalid image digest');
    expect(readFileSync(githubOutput, 'utf8')).toBe('');
    expect(readFileSync(stepSummary, 'utf8')).toBe('');
  });

  it('rejects a discovery tag that does not identify the recorded run attempt', () => {
    const githubOutput = createEmptyFile('invalid-tag-output');
    const stepSummary = createEmptyFile('invalid-tag-summary');

    const result = runScript(recordScript, {
      ...baseRecordEnvironment(githubOutput, stepSummary),
      CANDIDATE_TAG: `sha-${sourceRevision}-run-${runId}-attempt-99`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Candidate tag does not match the source revision and build attempt');
    expect(readFileSync(githubOutput, 'utf8')).toBe('');
    expect(readFileSync(stepSummary, 'utf8')).toBe('');
  });

  it.each([
    [
      'an artifact name for another attempt',
      { EVIDENCE_ARTIFACT_NAME: `reservation-service-security-evidence-${runId}-attempt-99` },
      'Evidence artifact name does not match the build attempt',
    ],
    [
      'a non-canonical contract path',
      { EVIDENCE_CONTRACT_PATH: 'other/component-candidate-evidence-v1alpha1.json' },
      'Evidence contract path must be security-evidence/component-candidate-evidence-v1alpha1.json',
    ],
    [
      'an attestation URL from another repository',
      { EVIDENCE_ATTESTATION_URL: 'https://github.com/example/other/attestations/246813579' },
      'Evidence attestation URL does not belong to the source repository',
    ],
    [
      'an attestation URL without a numeric identity',
      { EVIDENCE_ATTESTATION_URL: `https://github.com/${sourceRepository}/attestations/not-an-id` },
      'Evidence attestation URL does not identify an attestation',
    ],
  ] as const)('rejects %s without recording a handoff', (_scenario, environmentOverride, expectedError) => {
    const githubOutput = createEmptyFile('invalid-evidence-output');
    const stepSummary = createEmptyFile('invalid-evidence-summary');

    const result = runScript(recordScript, {
      ...baseRecordEnvironment(githubOutput, stepSummary),
      ...environmentOverride,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
    expect(readFileSync(githubOutput, 'utf8')).toBe('');
    expect(readFileSync(stepSummary, 'utf8')).toBe('');
  });
});

function basePrepareEnvironment(githubOutput: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    EXPECTED_REF: 'refs/heads/main',
    EXPECTED_REPOSITORY: sourceRepository,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_OUTPUT: githubOutput,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: sourceRepository,
    GITHUB_RUN_ATTEMPT: runAttempt,
    GITHUB_RUN_ID: runId,
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_SHA: sourceRevision,
  };
}

function baseRecordEnvironment(githubOutput: string, stepSummary: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ARTIFACT_NAME: 'reservation-service',
    BUILD_REF: `https://github.com/${sourceRepository}/actions/runs/${runId}/attempts/${runAttempt}`,
    CANDIDATE_DIGEST: imageDigest,
    CANDIDATE_IMAGE: `ghcr.io/${sourceRepository}`,
    CANDIDATE_REGISTRY: 'ghcr.io',
    CANDIDATE_REPOSITORY: sourceRepository,
    CANDIDATE_TAG: `sha-${sourceRevision}-run-${runId}-attempt-${runAttempt}`,
    EVIDENCE_ARTIFACT_NAME: evidenceArtifactName,
    EVIDENCE_ATTESTATION_URL: evidenceAttestationUrl,
    EVIDENCE_CONTRACT_PATH: evidenceContractPath,
    GITHUB_OUTPUT: githubOutput,
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_STEP_SUMMARY: stepSummary,
    SOURCE_REPOSITORY: sourceRepository,
    SOURCE_REVISION: sourceRevision,
  };
}

function createFakeGit(): string {
  const fakeBin = join(temporaryDirectory, 'bin');
  const fakeGit = join(fakeBin, 'git');

  mkdirSync(fakeBin);
  writeFileSync(
    fakeGit,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'printf \'%s\\n\' "$*" >> "${FAKE_GIT_CALLS}"',
      'printf \'%s\\t%s\\n\' "${FAKE_REMOTE_SHA}" "${4}"',
      '',
    ].join('\n'),
  );
  chmodSync(fakeGit, 0o755);

  return fakeBin;
}

function createEmptyFile(name: string): string {
  const path = join(temporaryDirectory, name);

  writeFileSync(path, '');

  return path;
}

function readKeyValueFile(path: string): Record<string, string> {
  const entries = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf('=');

      expect(separator).toBeGreaterThan(0);

      return [line.slice(0, separator), line.slice(separator + 1)] as const;
    });

  return Object.fromEntries(entries);
}

function runScript(script: string, environment: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: environment,
  });
}
