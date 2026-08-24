# Candidate Evidence Contracts

This directory contains the producer-owned machine-readable contract for facts
about reservation-service container candidates. It does not contain environment
admission, eligibility, deployment, or observed-state decisions.

## Source and generated schema

`automation/candidate-evidence/src/contract.ts` is the runtime source of truth for
`ComponentCandidateEvidence v1alpha1`. It uses strict Zod objects so unknown
fields fail at every object boundary. The generated Draft 2020-12 JSON Schema is
committed as `component-candidate-evidence-v1alpha1.schema.json` for consumers in
other languages and repositories.

Regenerate it from the repository root:

```bash
npm run contract:candidate-evidence:generate
```

The unit test compares the generated serialization with the committed file, so
contract changes cannot leave the JSON Schema stale.

## Semantic bindings

JSON Schema enforces the document shape, constants, patterns, and closed object
boundaries. Runtime producer and consumer validation must also enforce these
cross-field bindings:

- workflow URL identifies the declared canonical run and attempt;
- security artifact name identifies the same run and attempt;
- provenance subject digest equals the candidate digest;
- vulnerability-report subject equals the digest-pinned candidate;
- attestation URL identifies the declared attestation ID in the canonical source
  repository.

The attestation URL is a navigation field, not a trust anchor. The producer
copies the Sigstore bundle returned by the provenance action into the evidence
artifact and records its digest. Before emission, it must cryptographically
verify the bundle and confirm its subject name, subject digest, signer identity,
and workflow identity. Consumers must repeat those checks after downloading and
hashing the declared files. Structural JSON Schema validation alone is not an
admission decision.

Paths are fixed contract values rather than producer input. This prevents path
traversal and makes artifact layout changes explicit compatibility events.

The committed fixture uses synthetic IDs, digests, counts, and timestamps. It
documents the contract shape and does not identify a live image, run, or
attestation.

## Compatibility

`apiVersion` and `kind` identify the contract. Additive changes still require
consumer review because objects are closed. A breaking change uses a new
version. The canonical workflow must dual-emit the old and new versions until
the environment consumer supports the new version; it must not silently change
the meaning of `v1alpha1`.
