import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const verifier = join(repositoryRoot, 'automation', 'candidate-publication', 'src', 'verify-provenance.sh');
const sourceRepository = 'movie-reservation-platform-lab/movie-reservation-service';
const candidateImage = `ghcr.io/${sourceRepository}@sha256:${'b'.repeat(64)}`;
const sourceRevision = 'a'.repeat(40);

let temporaryDirectory = '';
let workspace = '';
let runnerTemp = '';
let bundlePath = '';
let fakeGhArguments = '';

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'reservation-provenance-'));
  workspace = join(temporaryDirectory, 'workspace');
  runnerTemp = join(temporaryDirectory, 'runner-temp');
  const fakeBin = join(temporaryDirectory, 'bin');

  mkdirSync(workspace);
  mkdirSync(runnerTemp);
  mkdirSync(fakeBin);
  bundlePath = join(runnerTemp, 'candidate-provenance.json');
  fakeGhArguments = join(temporaryDirectory, 'gh-arguments');
  writeFileSync(bundlePath, '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json"}\n');
  writeFileSync(
    join(fakeBin, 'gh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'printf "%s\\n" "$@" > "${FAKE_GH_ARGUMENTS}"',
      'if [[ "${FAKE_GH_STATUS:-0}" != "0" ]]; then',
      '  printf "verification failed\\n" >&2',
      'fi',
      'exit "${FAKE_GH_STATUS:-0}"',
      '',
    ].join('\n'),
  );
  chmodSync(join(fakeBin, 'gh'), 0o755);
  process.env.TEST_PROVENANCE_FAKE_PATH = fakeBin;
});

afterEach(() => {
  delete process.env.TEST_PROVENANCE_FAKE_PATH;
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe('candidate image provenance verification', () => {
  it('retains the action bundle and verifies the exact canonical identity', () => {
    const result = runVerifier();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const retainedBundle = join(workspace, 'security-evidence', 'reservation-service-provenance.json');

    expect(readFileSync(retainedBundle, 'utf8')).toBe(readFileSync(bundlePath, 'utf8'));
    expect(statSync(retainedBundle).mode & 0o777).toBe(0o600);
    expect(readFileSync(fakeGhArguments, 'utf8').trim().split('\n')).toEqual([
      'attestation',
      'verify',
      `oci://${candidateImage}`,
      '--repo',
      sourceRepository,
      '--bundle',
      retainedBundle,
      '--signer-workflow',
      'github.com/movie-reservation-platform-lab/movie-reservation-service/.github/workflows/ci.yml',
      '--source-ref',
      'refs/heads/main',
      '--source-digest',
      sourceRevision,
      '--predicate-type',
      'https://slsa.dev/provenance/v1',
      '--cert-oidc-issuer',
      'https://token.actions.githubusercontent.com',
      '--deny-self-hosted-runners',
      '--format',
      'json',
    ]);
  });

  it('propagates cryptographic verification failure', () => {
    const result = runVerifier({ FAKE_GH_STATUS: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('verification failed');
    expect(() => readFileSync(join(workspace, 'security-evidence', 'reservation-service-provenance.json'))).toThrow(
      /ENOENT/,
    );
  });

  it('rejects a bundle outside the runner temporary directory before invoking gh', () => {
    const outsideBundle = join(workspace, 'untrusted-bundle.json');

    writeFileSync(outsideBundle, '{}\n');

    const result = runVerifier({ PROVENANCE_BUNDLE_PATH: outsideBundle });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Provenance bundle must be located inside RUNNER_TEMP');
    expect(() => readFileSync(fakeGhArguments)).toThrow(/ENOENT/);
  });

  it('reports a missing bundle before realpath can fail', () => {
    const missingBundle = join(runnerTemp, 'missing-bundle.json');
    const result = runVerifier({ PROVENANCE_BUNDLE_PATH: missingBundle });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Provenance bundle is not a regular file');
    expect(() => readFileSync(fakeGhArguments)).toThrow(/ENOENT/);
  });

  it('does not overwrite a retained bundle path', () => {
    const retainedDirectory = join(workspace, 'security-evidence');

    mkdirSync(retainedDirectory);
    writeFileSync(join(retainedDirectory, 'reservation-service-provenance.json'), 'existing\n');

    const result = runVerifier();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Retained provenance bundle path must not already exist');
    expect(() => readFileSync(fakeGhArguments)).toThrow(/ENOENT/);
  });
});

function runVerifier(environmentOverrides: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  const fakeBin = process.env.TEST_PROVENANCE_FAKE_PATH;

  if (fakeBin === undefined) {
    throw new Error('Fake gh path was not initialized.');
  }

  const result = spawnSync('bash', [verifier], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BASH_ENV: '',
      CANDIDATE_IMAGE: candidateImage,
      FAKE_GH_ARGUMENTS: fakeGhArguments,
      GH_TOKEN: 'test-token',
      GITHUB_WORKSPACE: workspace,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      PROVENANCE_BUNDLE_PATH: bundlePath,
      RUNNER_TEMP: runnerTemp,
      SOURCE_REVISION: sourceRevision,
      ...environmentOverrides,
    },
  });

  expect(result.error).toBeUndefined();

  return result;
}
