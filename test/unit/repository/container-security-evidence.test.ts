import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const evaluator = join(repositoryRoot, '.github', 'actions', 'evaluate-container-vulnerabilities', 'evaluate.mjs');
const fixtures = join(repositoryRoot, 'test', 'fixtures', 'security');
const immutableImage = `ghcr.io/movie-reservation-platform-lab/movie-reservation-service@sha256:${'b'.repeat(64)}`;
const localImage = 'movie-reservation-service:local';
const evidenceArtifactName = 'reservation-service-security-evidence-123-attempt-2';

let temporaryDirectory = '';

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'reservation-security-evidence-'));
});

afterEach(() => {
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe('provisional container vulnerability policy', () => {
  it('reports HIGH findings without failing the candidate', () => {
    const evaluation = runEvaluator(join(fixtures, 'trivy-high-only.json'));

    expect(evaluation.result.status).toBe(0);
    expect(evaluation.result.stderr).toBe('');
    expect(readKeyValueFile(evaluation.githubOutput)).toEqual({
      'critical-count': '0',
      'high-count': '2',
      'policy-result': 'passed',
    });
    expect(evaluation.summary).toContain(`- Immutable candidate: \`${immutableImage}\``);
    expect(evaluation.summary).toContain('- HIGH findings: **2**');
    expect(evaluation.summary).toContain('- CRITICAL findings: **0**');
    expect(evaluation.summary).toContain('- Provisional policy: **PASSED**');
    expect(evaluation.summary).toContain(
      'HIGH findings do not fail this provisional gate, but admission requires explicit, recorded operator approval.',
    );
    expect(evaluation.summary).toContain(`\`${evidenceArtifactName}\``);
  });

  it('evaluates a local PR image when the report is bound to its exact tag', () => {
    const evaluation = runEvaluator(join(fixtures, 'trivy-local-high-only.json'), {
      EXPECTED_IMAGE: localImage,
      SUBJECT_KIND: 'local',
    });

    expect(evaluation.result.status).toBe(0);
    expect(evaluation.result.stderr).toBe('');
    expect(readKeyValueFile(evaluation.githubOutput)).toEqual({
      'critical-count': '0',
      'high-count': '1',
      'policy-result': 'passed',
    });
    expect(evaluation.summary).toContain(`- Local PR image: \`${localImage}\``);
  });

  it('writes the evidence summary before failing on CRITICAL findings', () => {
    const evaluation = runEvaluator(join(fixtures, 'trivy-critical.json'));

    expect(evaluation.result.status).toBe(1);
    expect(evaluation.result.stderr).toContain(
      'Provisional container policy failed: 2 CRITICAL vulnerability finding(s) detected.',
    );
    expect(readKeyValueFile(evaluation.githubOutput)).toEqual({
      'critical-count': '2',
      'high-count': '1',
      'policy-result': 'failed',
    });
    expect(evaluation.summary).toContain('- HIGH findings: **1**');
    expect(evaluation.summary).toContain('- CRITICAL findings: **2**');
    expect(evaluation.summary).toContain('- Provisional policy: **FAILED**');
    expect(evaluation.summary).toContain('#### CRITICAL findings');
    expect(evaluation.summary).toContain(
      '| <code>CVE-2099-1001</code> | <code>libcritical</code> | <code>1.0.0</code> | <code>1.0.1</code> |',
    );
    expect(evaluation.summary).toContain(
      '| <code>GHSA-aaaa-bbbb-cccc</code> | <code>critical&#124;package&lt;script&gt;</code> | <code>3.0.0</code> | <em>no fix reported</em> |',
    );
    expect(evaluation.summary).not.toContain('<script>');
  });

  it('passes a structurally valid report with no findings', () => {
    const evaluation = runEvaluator(join(fixtures, 'trivy-no-findings.json'));

    expect(evaluation.result.status).toBe(0);
    expect(readKeyValueFile(evaluation.githubOutput)).toEqual({
      'critical-count': '0',
      'high-count': '0',
      'policy-result': 'passed',
    });
    expect(evaluation.summary).toContain('No HIGH findings require an admission decision for this candidate.');
  });

  it('fails closed when the report belongs to a different digest', () => {
    const evaluation = runEvaluator(join(fixtures, 'trivy-high-only.json'), {
      EXPECTED_IMAGE: `${immutableImage.slice(0, -1)}c`,
    });

    expect(evaluation.result.status).toBe(1);
    expect(evaluation.result.stderr).toContain('does not match expected image');
    expect(readFileSync(evaluation.githubOutput, 'utf8')).toBe('');
    expect(evaluation.summary).toBe('');
  });

  it('fails closed when the report is not valid JSON', () => {
    const malformedReport = join(temporaryDirectory, 'malformed-report.json');

    writeFileSync(malformedReport, '{"SchemaVersion": 2');

    const evaluation = runEvaluator(malformedReport, { GITHUB_WORKSPACE: temporaryDirectory });

    expect(evaluation.result.status).toBe(1);
    expect(evaluation.result.stderr).toContain('Unable to evaluate container vulnerability evidence');
    expect(readFileSync(evaluation.githubOutput, 'utf8')).toBe('');
    expect(evaluation.summary).toBe('');
  });

  it('rejects a local tag when the declared subject kind is immutable', () => {
    const evaluation = runEvaluator(join(fixtures, 'trivy-local-high-only.json'), {
      EXPECTED_IMAGE: localImage,
    });

    expect(evaluation.result.status).toBe(1);
    expect(evaluation.result.stderr).toContain('Expected image is not an immutable GHCR reference');
    expect(readFileSync(evaluation.githubOutput, 'utf8')).toBe('');
    expect(evaluation.summary).toBe('');
  });
});

interface Evaluation {
  readonly githubOutput: string;
  readonly result: SpawnSyncReturns<string>;
  readonly summary: string;
}

function runEvaluator(reportPath: string, environmentOverrides: NodeJS.ProcessEnv = {}): Evaluation {
  const githubOutput = createEmptyFile('github-output');
  const githubStepSummary = createEmptyFile('github-step-summary');
  const result = spawnSync(process.execPath, [evaluator], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EVIDENCE_ARTIFACT_NAME: evidenceArtifactName,
      EXPECTED_IMAGE: immutableImage,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_STEP_SUMMARY: githubStepSummary,
      GITHUB_WORKSPACE: repositoryRoot,
      REPORT_PATH: reportPath,
      SUBJECT_KIND: 'immutable-ghcr',
      ...environmentOverrides,
    },
  });

  expect(result.error).toBeUndefined();

  return {
    githubOutput,
    result,
    summary: readFileSync(githubStepSummary, 'utf8'),
  };
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
