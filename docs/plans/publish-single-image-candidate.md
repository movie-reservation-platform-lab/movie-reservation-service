# Implementation Plan: Publish a Single-Image Candidate

## 1. Summary

Issue #32 makes the canonical `main` publisher compatible with the approved
first-slice admission mechanic by setting `provenance: false` on the existing
`docker/build-push-action` step. The separate GitHub provenance attestation and
all SBOM, Trivy, evidence, immutable-tag, and main-only controls remain
unchanged.

## 2. Goals

- Publish one `linux/amd64` OCI/Docker image manifest rather than an image index
  containing a BuildKit provenance attestation manifest.
- Preserve the explicit `actions/attest-build-provenance` result and its offline
  verification.
- Add a workflow contract regression test for both facts.
- Keep the PR small enough to review as one producer-compatibility slice.

## 3. Non-goals

- Multi-platform images or index/manifest-list admission.
- Removing or weakening any provenance, SBOM, vulnerability, evidence, or
  publication protection.
- Publishing from this issue branch.
- Copying to ECR, deploying, or mutating AWS.

## 4. Current State

`.github/workflows/ci.yml` publishes only `linux/amd64` from canonical `main`.
The pinned Docker action has no explicit `provenance` input, so BuildKit adds a
registry provenance attestation and the pushed digest resolves to an OCI index.

The next step already invokes pinned `actions/attest-build-provenance` with the
exact published digest and `push-to-registry: false`. The workflow then retains
and verifies that bundle before generating SBOM, Trivy, candidate evidence, and
an evidence-package attestation.

`automation/repository/test/workflow-contract.test.ts` already asserts the
main-only publisher, `linux/amd64`, explicit subject digest,
`push-to-registry: false`, provenance verification, evidence ordering, and
security gates. It does not assert that Docker registry provenance is disabled.

## 5. Requirements and Assumptions

### Confirmed Requirements

- Add `provenance: false` only to the existing publication action.
- Preserve the separate GitHub attestation and current verification/evidence
  flow.
- Keep `linux/amd64`, immutable tagging, and canonical-main protection.
- Verify the registry media type and GitHub attestation after a fresh candidate
  is published from merged `main`.

### Assumptions

- The pinned Docker action continues to map `provenance: false` to disabling its
  BuildKit provenance attestation.
- No `sbom` or general `attests` input is added to the Docker publication step.
- Merge to `main` triggers the existing publisher; no manual feature-branch
  publication is needed.

### Open Questions

None. The consumer limitation and producer behavior are both established.

## 6. Proposed Design

Add this exact input beside `platforms` and `push`:

```yaml
provenance: false
```

Extend the canonical publisher contract test to require the input while
retaining its existing assertions for:

- `platforms: linux/amd64`;
- explicit `actions/attest-build-provenance`;
- `subject-digest: ${{ steps.publish.outputs.digest }}`;
- `push-to-registry: false`;
- provenance-bundle verification before scanning/evidence; and
- all existing publication and evidence gates.

No workflow restructuring or new action is justified for a one-input policy
change.

## 7. Alternatives Considered

### Teach admission to select the amd64 child from the index

- Pros: preserves Docker's registry attestation.
- Cons: changes the approved candidate identity and bypasses exact-digest copy.
- Decision: rejected.

### Accept indexes in the first infra slice

- Pros: supports future multi-platform candidates sooner.
- Cons: broadens manifest equivalence and copy verification before it is
  designed.
- Decision: deferred to the existing follow-up boundary.

### Remove all provenance

- Pros: yields a single manifest.
- Cons: destroys required candidate identity evidence.
- Decision: rejected; only Docker registry provenance is disabled.

## 8. API / Interface Changes

The internal workflow contract now explicitly states that the registry
publication carries no BuildKit provenance attachment. Application APIs,
candidate-evidence schema, artifact names, tags, and action outputs do not
change.

## 9. Data Model / Persistence Changes

None. A new post-merge candidate digest is expected; existing registry objects
are not rewritten or deleted.

## 10. Security, Privacy, and Abuse Considerations

- The separate GitHub attestation remains digest-, repository-, workflow-, ref-,
  and source-revision-bound and is verified before eligibility.
- PR jobs receive no new write permission.
- The publisher remains canonical-main only and uses immutable candidate tags.
- SBOM, Trivy, CRITICAL policy, evidence attestation, and rejected diagnostics
  remain untouched.

## 11. Performance, Scalability, and Reliability Considerations

Disabling one registry attestation slightly reduces registry output and does not
add a job or network call. The post-merge check must inspect the digest itself,
not infer media type from the GHCR UI.

## 12. Implementation Steps

1. Add `provenance: false` to the pinned Docker publication step.
   - File: `.github/workflows/ci.yml`.
   - Verification: workflow remains valid and the input is on the publish step.
2. Extend the repository workflow contract test.
   - File: `automation/repository/test/workflow-contract.test.ts`.
   - Verification: the test requires Docker provenance disabled and retains the
     explicit GitHub provenance assertions.
3. Run focused and full repository checks.
   - Verification: automation contract test, `npm run check`, `git diff --check`.
4. After explicit push/merge authorization and merge, inspect one fresh main
   candidate.
   - Verification: digest response media type is an OCI/Docker image manifest,
     not an index/list; `gh attestation verify` still succeeds for that digest.

## 13. Testing Strategy

- Static workflow contract test for exact producer configuration and preserved
  attestation chain.
- Full automation tests to prevent accidental evidence-contract regression.
- Full local check suite for application and automation separation.
- Post-merge registry/attestation verification is the only check that proves
  actual GHCR output; local YAML tests cannot prove registry behavior.

## 14. Rollout / Migration Plan

The next successful canonical `main` publication creates a fresh candidate with
the new shape. Do not mutate or reinterpret earlier index-shaped candidates.
Environments #17 selects only the newly verified compatible digest.

Rollback is a normal revert PR, but doing so makes new candidates incompatible
with the first-slice admission mechanic again.

## 15. Risks and Mitigations

| Risk                                                      |   Impact | Likelihood | Mitigation                                                             |
| --------------------------------------------------------- | -------: | ---------: | ---------------------------------------------------------------------- |
| Explicit GitHub provenance is accidentally removed        | Critical |        Low | Existing and strengthened contract assertions                          |
| Another Docker attestation recreates an index             |     High |        Low | Keep `sbom`/`attests` absent; inspect fresh digest media type          |
| Old incompatible digest is selected for admission         |     High |     Medium | Record and use only the fresh verified post-merge digest               |
| Security evidence flow changes in a tiny compatibility PR |     High |        Low | Limit implementation to workflow input plus focused contract assertion |

## 16. Done Criteria

- Docker publication explicitly disables registry provenance.
- Explicit GitHub provenance and all evidence/security gates remain enforced.
- Local checks pass.
- After merge, one fresh main candidate is proven to be a single image manifest
  and its GitHub attestation verifies.
- No AWS action occurs.

## 17. Review Checklist

- [x] Scope and non-goals are explicit.
- [x] Existing workflow and contract tests were inspected.
- [x] Alternatives and consumer identity implications were considered.
- [x] Security and post-merge verification are explicit.
- [x] The change remains one small reviewable PR.

## 18. Handoff Prompt for Implementation Agent

```text
Implement docs/plans/publish-single-image-candidate.md for service issue #32.

Change only the existing Docker publication input and its workflow contract
test. Preserve explicit GitHub provenance, linux/amd64, SBOM, Trivy, candidate
evidence, immutable tagging, and canonical-main protections. Do not publish,
push, merge, deploy, or contact AWS. Run the focused automation test, npm run
check, and git diff --check.
```

## Sources

- `movie-platform-infra/docs/plans/reservation-artifact-copy-mechanics.md`
- [docker/build-push-action inputs](https://github.com/docker/build-push-action)
- [Docker build attestations](https://docs.docker.com/build/metadata/attestations/)
