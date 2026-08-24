import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseComponentCandidateEvidence } from '../src/contract.js';

const repositoryRoot = process.cwd();
const emitter = join(repositoryRoot, 'automation', 'candidate-evidence', 'src', 'emit.mjs');
const sourceRepository = 'movie-reservation-platform-lab/movie-reservation-service';
const candidateRepository = `ghcr.io/${sourceRepository}`;
const candidateDigest = `sha256:${'b'.repeat(64)}`;
const sourceRevision = 'a'.repeat(40);
const attestationId = '987654321';
const evidenceDocumentName = 'component-candidate-evidence-v1alpha1.json';

let workspace = '';
let evidenceDirectory = '';
let externalDirectory = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'reservation-candidate-evidence-'));
  externalDirectory = mkdtempSync(join(tmpdir(), 'reservation-external-evidence-'));
  evidenceDirectory = join(workspace, 'security-evidence');
  mkdirSync(evidenceDirectory);
  writeFileSync(join(evidenceDirectory, 'reservation-service-provenance.json'), '{"bundle":"verified"}\n');
  writeFileSync(join(evidenceDirectory, 'reservation-service.cdx.json'), '{"bomFormat":"CycloneDX"}\n');
  writeFileSync(
    join(evidenceDirectory, 'reservation-service-vulnerabilities.json'),
    JSON.stringify({
      ArtifactName: `${candidateRepository}@${candidateDigest}`,
      ArtifactType: 'container_image',
      Results: [
        {
          Vulnerabilities: [
            ...Array.from({ length: 12 }, () => ({ Severity: 'LOW' })),
            ...Array.from({ length: 3 }, () => ({ Severity: 'MEDIUM' })),
            ...Array.from({ length: 2 }, () => ({ Severity: 'HIGH' })),
          ],
        },
      ],
      SchemaVersion: 2,
    }),
  );
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
  rmSync(externalDirectory, { force: true, recursive: true });
});

describe('candidate evidence emission', () => {
  it('hashes and emits producer facts for the exact canonical candidate', () => {
    const result = runEmitter();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const evidence = parseComponentCandidateEvidence(
      JSON.parse(readFileSync(join(evidenceDirectory, evidenceDocumentName), 'utf8')),
    );

    expect(evidence.source).toEqual({
      ref: 'refs/heads/main',
      repository: sourceRepository,
      revision: sourceRevision,
    });
    expect(evidence.workflow).toEqual({
      job: 'publish-candidate',
      path: '.github/workflows/ci.yml',
      runAttempt: 2,
      runId: '123456789',
      url: `https://github.com/${sourceRepository}/actions/runs/123456789/attempts/2`,
    });
    expect(evidence.candidate.digest).toBe(candidateDigest);
    expect(evidence.provenance).toMatchObject({
      attestationId,
      attestationUrl: `https://github.com/${sourceRepository}/attestations/${attestationId}`,
      subjectDigest: candidateDigest,
      subjectName: candidateRepository,
    });
    expect(evidence.provenance.bundle.sha256).toBe(
      hashFile(join(evidenceDirectory, 'reservation-service-provenance.json')),
    );
    expect(evidence.securityEvidence.sbom.sha256).toBe(
      hashFile(join(evidenceDirectory, 'reservation-service.cdx.json')),
    );
    expect(evidence.securityEvidence.vulnerabilities).toMatchObject({
      counts: { critical: 0, high: 2, low: 12, medium: 3, unknown: 0 },
      sha256: hashFile(join(evidenceDirectory, 'reservation-service-vulnerabilities.json')),
      subject: `${candidateRepository}@${candidateDigest}`,
    });
    expect(evidence.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('fails without writing evidence when the report subject does not match the candidate', () => {
    const reportPath = join(evidenceDirectory, 'reservation-service-vulnerabilities.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;

    report.ArtifactName = `${candidateRepository}@sha256:${'c'.repeat(64)}`;
    writeFileSync(reportPath, JSON.stringify(report));

    const result = runEmitter();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Vulnerability report subject does not match');
    expect(() => readFileSync(join(evidenceDirectory, evidenceDocumentName))).toThrow(/ENOENT/);
  });

  it('fails without writing evidence when the report contains an unsupported severity', () => {
    const reportPath = join(evidenceDirectory, 'reservation-service-vulnerabilities.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      Results: Array<{ Vulnerabilities: Array<{ Severity: string }> }>;
    };
    const firstVulnerability = report.Results[0]?.Vulnerabilities[0];

    expect(firstVulnerability).toBeDefined();
    if (firstVulnerability === undefined) {
      throw new Error('Expected vulnerability fixture data.');
    }

    firstVulnerability.Severity = 'SUPER_HIGH';
    writeFileSync(reportPath, JSON.stringify(report));

    const result = runEmitter();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has unsupported severity');
    expect(() => readFileSync(join(evidenceDirectory, evidenceDocumentName))).toThrow(/ENOENT/);
  });

  it('fails without writing evidence when a required file is missing', () => {
    rmSync(join(evidenceDirectory, 'reservation-service-provenance.json'));

    const result = runEmitter();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unable to emit candidate evidence');
    expect(() => readFileSync(join(evidenceDirectory, evidenceDocumentName))).toThrow(/ENOENT/);
  });

  it('rejects an evidence file that resolves outside the workspace', () => {
    const provenancePath = join(evidenceDirectory, 'reservation-service-provenance.json');
    const externalProvenance = join(externalDirectory, 'provenance.json');

    rmSync(provenancePath);
    writeFileSync(externalProvenance, '{"bundle":"outside"}\n');
    symlinkSync(externalProvenance, provenancePath);

    const result = runEmitter();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Evidence path must stay inside GITHUB_WORKSPACE');
    expect(() => readFileSync(join(evidenceDirectory, evidenceDocumentName))).toThrow(/ENOENT/);
  });

  it('does not overwrite an existing evidence document', () => {
    const evidenceDocument = join(evidenceDirectory, evidenceDocumentName);

    writeFileSync(evidenceDocument, 'existing\n');

    const result = runEmitter();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unable to emit candidate evidence');
    expect(readFileSync(evidenceDocument, 'utf8')).toBe('existing\n');
  });

  it('fails without writing evidence when attestation identity does not match its URL', () => {
    const result = runEmitter({
      ATTESTATION_URL: `https://github.com/${sourceRepository}/attestations/111111111`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unable to emit candidate evidence');
    expect(() => readFileSync(join(evidenceDirectory, evidenceDocumentName))).toThrow(/ENOENT/);
  });
});

function runEmitter(environmentOverrides: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, [emitter], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATTESTATION_ID: attestationId,
      ATTESTATION_URL: `https://github.com/${sourceRepository}/attestations/${attestationId}`,
      CANDIDATE_DIGEST: candidateDigest,
      CANDIDATE_REPOSITORY: candidateRepository,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: sourceRepository,
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_RUN_ID: '123456789',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_SHA: sourceRevision,
      GITHUB_WORKSPACE: workspace,
      ...environmentOverrides,
    },
  });

  expect(result.error).toBeUndefined();

  return result;
}

function hashFile(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}
