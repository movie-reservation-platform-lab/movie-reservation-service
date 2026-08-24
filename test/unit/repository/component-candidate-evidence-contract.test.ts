import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  componentCandidateEvidenceJsonSchemaPath,
  componentCandidateEvidenceSchema,
  parseComponentCandidateEvidence,
  serializeComponentCandidateEvidenceJsonSchema,
  type ComponentCandidateEvidence,
} from '../../../scripts/candidate-evidence-contract.js';

const repositoryRoot = process.cwd();
const fixturePath = join(
  repositoryRoot,
  'test',
  'fixtures',
  'candidate-evidence',
  'component-candidate-evidence-v1alpha1.json',
);

describe('ComponentCandidateEvidence v1alpha1 contract', () => {
  it('accepts producer facts for the canonical immutable reservation candidate', () => {
    const evidence = parseComponentCandidateEvidence(readFixture());

    expect(evidence.component).toBe('reservation-service');
    expect(evidence.candidate.platform).toEqual({ architecture: 'amd64', os: 'linux' });
    expect(evidence.securityEvidence.vulnerabilities.counts).toEqual({
      critical: 0,
      high: 2,
      low: 12,
      medium: 3,
      unknown: 0,
    });
  });

  it('keeps the committed JSON Schema synchronized with the runtime contract', async () => {
    const committedSchema = readFileSync(join(repositoryRoot, componentCandidateEvidenceJsonSchemaPath), 'utf8');

    expect(committedSchema).toBe(await serializeComponentCandidateEvidenceJsonSchema());
  });

  it('rejects unsupported versions, kinds, and unknown fields', () => {
    const evidence = readFixture();

    expect(componentCandidateEvidenceSchema.safeParse({ ...evidence, apiVersion: 'v1' }).success).toBe(false);
    expect(componentCandidateEvidenceSchema.safeParse({ ...evidence, kind: 'PromotionDecision' }).success).toBe(false);
    expect(componentCandidateEvidenceSchema.safeParse({ ...evidence, environmentGateStatus: 'passed' }).success).toBe(
      false,
    );
    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        candidate: { ...evidence.candidate, tag: 'latest' },
      }).success,
    ).toBe(false);
  });

  it('rejects malformed source and immutable artifact identities', () => {
    const evidence = readFixture();

    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        source: { ...evidence.source, revision: 'main' },
      }).success,
    ).toBe(false);
    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        candidate: { ...evidence.candidate, digest: 'sha256:not-a-digest' },
      }).success,
    ).toBe(false);
    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        candidate: { ...evidence.candidate, platform: { architecture: 'arm64', os: 'linux' } },
      }).success,
    ).toBe(false);
  });

  it('binds workflow and evidence artifact identity to the exact run attempt', () => {
    expect.hasAssertions();
    const evidence = readFixture();

    expectSemanticIssue(
      {
        ...evidence,
        workflow: { ...evidence.workflow, url: evidence.workflow.url.replace('/attempts/2', '/attempts/3') },
      },
      ['workflow', 'url'],
    );
    expectSemanticIssue(
      {
        ...evidence,
        securityEvidence: { ...evidence.securityEvidence, artifactName: 'reservation-service-security-evidence' },
      },
      ['securityEvidence', 'artifactName'],
    );
  });

  it('binds provenance and vulnerability evidence to the candidate digest', () => {
    expect.hasAssertions();
    const evidence = readFixture();
    const differentDigest = `sha256:${'e'.repeat(64)}`;

    expectSemanticIssue(
      {
        ...evidence,
        provenance: { ...evidence.provenance, subjectDigest: differentDigest },
      },
      ['provenance', 'subjectDigest'],
    );
    expectSemanticIssue(
      {
        ...evidence,
        securityEvidence: {
          ...evidence.securityEvidence,
          vulnerabilities: { ...evidence.securityEvidence.vulnerabilities, subject: `candidate@${differentDigest}` },
        },
      },
      ['securityEvidence', 'vulnerabilities', 'subject'],
    );
  });

  it('rejects malformed evidence digests, counts, timestamps, and attestation locations', () => {
    const evidence = readFixture();

    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        securityEvidence: {
          ...evidence.securityEvidence,
          sbom: { ...evidence.securityEvidence.sbom, sha256: 'cccc' },
        },
      }).success,
    ).toBe(false);
    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        provenance: {
          ...evidence.provenance,
          bundle: { ...evidence.provenance.bundle, sha256: 'sha256:not-a-digest' },
        },
      }).success,
    ).toBe(false);
    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        securityEvidence: {
          ...evidence.securityEvidence,
          sbom: { ...evidence.securityEvidence.sbom, path: '../../stolen.json' },
        },
      }).success,
    ).toBe(false);
    expect(
      componentCandidateEvidenceSchema.safeParse({
        ...evidence,
        securityEvidence: {
          ...evidence.securityEvidence,
          vulnerabilities: {
            ...evidence.securityEvidence.vulnerabilities,
            counts: { ...evidence.securityEvidence.vulnerabilities.counts, high: -1 },
          },
        },
      }).success,
    ).toBe(false);
    expect(componentCandidateEvidenceSchema.safeParse({ ...evidence, generatedAt: '2026-08-24' }).success).toBe(false);
    expectSemanticIssue(
      {
        ...evidence,
        provenance: {
          ...evidence.provenance,
          attestationUrl:
            'https://github.com/movie-reservation-platform-lab/movie-reservation-service/attestations/111111111',
        },
      },
      ['provenance', 'attestationUrl'],
    );
  });
});

function readFixture(): ComponentCandidateEvidence {
  return parseComponentCandidateEvidence(JSON.parse(readFileSync(fixturePath, 'utf8')));
}

function expectSemanticIssue(input: unknown, expectedPath: PropertyKey[]): void {
  const result = componentCandidateEvidenceSchema.safeParse(input);

  if (result.success) {
    throw new Error(`Expected semantic validation to fail at ${expectedPath.join('.')}.`);
  }

  const issue = result.error.issues.find(
    ({ path }) =>
      path.length === expectedPath.length && path.every((segment, index) => segment === expectedPath[index]),
  );

  expect(issue?.code).toBe('custom');
  expect(issue?.message).toContain('Value must match');
}
