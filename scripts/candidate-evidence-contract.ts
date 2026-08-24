import { z } from 'zod';
import { format, resolveConfig } from 'prettier';

export const componentCandidateEvidenceApiVersion = 'ci.movie-platform.dev/v1alpha1' as const;
export const componentCandidateEvidenceKind = 'ComponentCandidateEvidence' as const;
export const componentCandidateEvidenceJsonSchemaPath =
  'contracts/component-candidate-evidence-v1alpha1.schema.json' as const;

const sourceRepository = 'movie-reservation-platform-lab/movie-reservation-service';
const candidateRepository = `ghcr.io/${sourceRepository}`;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const gitObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const runIdPattern = /^[1-9][0-9]*$/;
const provenanceBundlePath = 'security-evidence/reservation-service-provenance.json';
const sbomPath = 'security-evidence/reservation-service.cdx.json';
const vulnerabilityReportPath = 'security-evidence/reservation-service-vulnerabilities.json';

const sha256DigestSchema = z
  .string()
  .regex(digestPattern)
  .describe('Lowercase SHA-256 digest with the sha256: prefix.');

const contentAddressedFileSchema = <const Path extends string>(path: Path, description: string) =>
  z
    .strictObject({
      path: z.literal(path).describe('Fixed path inside the downloaded security-evidence artifact.'),
      sha256: sha256DigestSchema.describe('SHA-256 digest of the file bytes at path.'),
    })
    .describe(description);

const vulnerabilityCountsSchema = z.strictObject({
  unknown: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
});

const structuralComponentCandidateEvidenceSchema = z
  .strictObject({
    apiVersion: z.literal(componentCandidateEvidenceApiVersion).describe('Version of this producer contract.'),
    kind: z.literal(componentCandidateEvidenceKind).describe('Discriminator for candidate evidence documents.'),
    component: z.literal('reservation-service').describe('Platform component that produced the candidate.'),
    source: z
      .strictObject({
        repository: z.literal(sourceRepository).describe('Canonical GitHub source repository.'),
        revision: z.string().regex(gitObjectIdPattern).describe('Full Git commit object ID built by the workflow.'),
        ref: z.literal('refs/heads/main').describe('Canonical source ref allowed to publish candidates.'),
      })
      .describe('Immutable source identity for the candidate build.'),
    workflow: z
      .strictObject({
        path: z.literal('.github/workflows/ci.yml').describe('Canonical workflow path.'),
        job: z.literal('publish-candidate').describe('Canonical candidate-producing job.'),
        runId: z.string().regex(runIdPattern).describe('GitHub Actions workflow run ID.'),
        runAttempt: z.number().int().positive().describe('One-based attempt number for the workflow run.'),
        url: z.url().max(2048).describe('URL for the exact GitHub Actions run attempt.'),
      })
      .describe('Canonical workflow execution that produced the candidate.'),
    candidate: z
      .strictObject({
        repository: z.literal(candidateRepository).describe('Canonical GHCR repository.'),
        digest: sha256DigestSchema.describe('Immutable OCI manifest digest selected for deployment.'),
        platform: z
          .strictObject({
            os: z.literal('linux'),
            architecture: z.literal('amd64'),
          })
          .describe('Single deployable platform represented by the candidate digest.'),
      })
      .describe('Immutable container candidate identity.'),
    provenance: z
      .strictObject({
        subjectName: z.literal(candidateRepository).describe('OCI subject name asserted by the provenance.'),
        subjectDigest: sha256DigestSchema.describe('OCI subject digest asserted by the provenance.'),
        predicateType: z.literal('https://slsa.dev/provenance/v1').describe('Expected provenance predicate type.'),
        attestationId: z.string().regex(runIdPattern).describe('GitHub artifact attestation ID.'),
        attestationUrl: z.url().max(2048).describe('GitHub navigation URL for the declared attestation ID.'),
        bundle: contentAddressedFileSchema(
          provenanceBundlePath,
          'Content-addressed Sigstore bundle returned by the provenance action.',
        )
          .extend({
            format: z.literal('sigstore-bundle-json').describe('Serialized Sigstore bundle JSON.'),
          })
          .describe('Content-addressed Sigstore bundle returned by the provenance action.'),
      })
      .describe('Cryptographically verifiable provenance identity and retained bundle.'),
    securityEvidence: z
      .strictObject({
        artifactName: z.string().min(1).max(256).describe('Workflow artifact containing all declared evidence files.'),
        sbom: contentAddressedFileSchema(sbomPath, 'Content-addressed CycloneDX software bill of materials.')
          .extend({
            format: z.literal('cyclonedx-json').describe('CycloneDX JSON document.'),
          })
          .describe('Content-addressed CycloneDX software bill of materials.'),
        vulnerabilities: contentAddressedFileSchema(
          vulnerabilityReportPath,
          'Content-addressed Trivy vulnerability report for the immutable candidate.',
        )
          .extend({
            format: z.literal('trivy-json').describe('Trivy JSON vulnerability report.'),
            subject: z.string().min(1).max(512).describe('Digest-pinned OCI subject scanned by Trivy.'),
            counts: vulnerabilityCountsSchema.describe('Finding counts by normalized severity.'),
          })
          .describe('Content-addressed Trivy vulnerability report for the immutable candidate.'),
      })
      .describe('Content-addressed security evidence emitted by the canonical workflow.'),
    generatedAt: z.iso.datetime({ offset: true }).describe('RFC 3339 time when this evidence document was emitted.'),
  })
  .describe('Producer-owned facts for one immutable reservation-service candidate from its canonical build.');

export const componentCandidateEvidenceSchema = structuralComponentCandidateEvidenceSchema.superRefine(
  (evidence, context) => {
    const expectedRunUrl = `https://github.com/${sourceRepository}/actions/runs/${evidence.workflow.runId}/attempts/${evidence.workflow.runAttempt}`;
    const expectedArtifactName = `reservation-service-security-evidence-${evidence.workflow.runId}-attempt-${evidence.workflow.runAttempt}`;
    const expectedImmutableCandidate = `${evidence.candidate.repository}@${evidence.candidate.digest}`;
    const expectedAttestationUrl = `https://github.com/${sourceRepository}/attestations/${evidence.provenance.attestationId}`;
    const addMismatch = (matches: boolean, path: PropertyKey[], expected: string): void => {
      if (matches) {
        return;
      }

      context.addIssue({
        code: 'custom',
        message: `Value must match ${expected}.`,
        path,
      });
    };

    addMismatch(evidence.workflow.url === expectedRunUrl, ['workflow', 'url'], expectedRunUrl);
    addMismatch(
      evidence.securityEvidence.artifactName === expectedArtifactName,
      ['securityEvidence', 'artifactName'],
      expectedArtifactName,
    );
    addMismatch(
      evidence.provenance.subjectDigest === evidence.candidate.digest,
      ['provenance', 'subjectDigest'],
      evidence.candidate.digest,
    );
    addMismatch(
      evidence.securityEvidence.vulnerabilities.subject === expectedImmutableCandidate,
      ['securityEvidence', 'vulnerabilities', 'subject'],
      expectedImmutableCandidate,
    );
    addMismatch(
      evidence.provenance.attestationUrl === expectedAttestationUrl,
      ['provenance', 'attestationUrl'],
      expectedAttestationUrl,
    );
  },
);

export type ComponentCandidateEvidence = z.infer<typeof componentCandidateEvidenceSchema>;

export function parseComponentCandidateEvidence(input: unknown): ComponentCandidateEvidence {
  return componentCandidateEvidenceSchema.parse(input);
}

export function generateComponentCandidateEvidenceJsonSchema(): Record<string, unknown> {
  const generated = JSON.parse(
    JSON.stringify(z.toJSONSchema(componentCandidateEvidenceSchema, { target: 'draft-2020-12' })),
  ) as Record<string, unknown>;
  const { $schema, ...definition } = generated;

  return {
    $schema,
    $id: 'https://schemas.movie-platform.dev/ci/component-candidate-evidence-v1alpha1.schema.json',
    title: 'ComponentCandidateEvidence v1alpha1',
    description: 'Producer-owned facts for one immutable reservation-service candidate from its canonical build.',
    ...definition,
  };
}

export async function serializeComponentCandidateEvidenceJsonSchema(): Promise<string> {
  const prettierConfig = await resolveConfig(componentCandidateEvidenceJsonSchemaPath);

  return format(JSON.stringify(generateComponentCandidateEvidenceJsonSchema()), {
    ...prettierConfig,
    filepath: componentCandidateEvidenceJsonSchemaPath,
  });
}
