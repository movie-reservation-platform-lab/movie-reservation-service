# Implementation Plan: Emit Candidate Evidence

## 1. Summary

Extend the canonical `main` publisher so it emits the merged
`ComponentCandidateEvidence v1alpha1` contract for the exact image it already
publishes, attests, scans, and admits through the provisional CRITICAL gate.

The recommended design adds a dependency-free Node emitter and a small local
action for offline Sigstore-bundle verification, then attests the completed
evidence files before uploading one run-attempt-specific handoff artifact. CI
helpers and their tests live under `automation/` and run independently from
service tests. No PR workflow receives additional permissions.

### Release Slice Status

- Step 1, the automation source and test boundary, shipped in service PR #27.
- Step 2, image-provenance retention and verification, shipped in service PR
  #28.
- This PR implements only the dependency-free emitter and its contract tests.
- Workflow invocation and final handoff integration remain deferred to PR 4.

## 2. Goals

- Retain and cryptographically verify the image-provenance bundle returned by
  the pinned GitHub action.
- Bind verification to the canonical repository, `main` ref, source revision,
  signer workflow, and exact OCI digest.
- Record UNKNOWN, LOW, MEDIUM, HIGH, and CRITICAL vulnerability counts.
- Hash the exact provenance, SBOM, and vulnerability files.
- Generate one candidate-evidence document after validating every producer
  input and cross-field binding.
- Attest the completed evidence package and upload it under the exact run and
  attempt name.
- Fail closed without emitting a canonical handoff artifact when any required
  step fails.
- Keep automation source, typechecking, and tests separate from application
  unit and integration test execution.

## 3. Non-goals

- Environment admission, promotion, deployment, or AWS access.
- Long-term evidence retention.
- Changing the provisional CRITICAL-only policy.
- Changing the candidate-evidence schema or adding another contract version.
- Granting write credentials to pull-request jobs.

## 4. Current State

`.github/workflows/ci.yml` already publishes one `linux/amd64` GHCR image from
canonical `main`, creates GitHub build provenance, generates CycloneDX and Trivy
JSON for the exact published digest, applies the CRITICAL gate, and uploads the
two security files for 14 days.

`automation/candidate-evidence/src/contract.ts` owns the strict Zod contract and
its generated JSON Schema. The contract requires a content-addressed Sigstore
bundle, exact workflow and attestation identities, all vulnerability severity
counts, and fixed evidence paths. The workflow does not yet populate it.

The local evaluator validates the Trivy report subject for the provisional
policy. The publisher uploads under the canonical artifact name even after a
policy failure, which does not provide the complete handoff package required by
the new contract.

## 5. Requirements and Assumptions

### Confirmed Requirements

- Only a canonical push to this repository's `main` may emit evidence.
- The evidence subject is the exact digest returned by `build-push-action`.
- GitHub URLs are navigation fields; the retained Sigstore bundle is verified.
- The evidence package receives its own GitHub provenance attestation.
- Canonical evidence upload and candidate handoff occur only after every gate.
- Existing exact-SHA action pinning and least-privilege permissions remain.

### Assumptions

- The pinned provenance action continues to return `bundle-path`,
  `attestation-id`, and `attestation-url` as its declared interface.
- GitHub-hosted runners provide a `gh` version supporting offline bundle
  verification; an unsupported CLI fails the job closed.
- Rejected diagnostic evidence may retain only available scan files under a
  clearly non-canonical artifact name.
- Formatting and linting remain repository-wide hygiene gates. Separation
  applies to automation ownership, typechecking, test discovery, and test
  execution rather than duplicating style/lint configurations.

### Open Questions

None. The owner-approved issue and merged producer contract determine the
behavior needed for this slice.

## 6. Proposed Design

1. Follow the sibling infrastructure repository's ownership boundary: put CI
   helper implementations and co-located tests under `automation/`, with a
   dedicated TypeScript project, Vitest config, package commands, and CI job.
   Composite action manifests remain thin GitHub adapters under
   `.github/actions/`.
2. Give the image-provenance action a step ID and retain its returned bundle.
3. A repository-local composite action validates fixed identities, restricts
   the bundle source to `RUNNER_TEMP`, copies it to the contract path, and runs
   `gh attestation verify` against the digest-pinned OCI subject with exact
   repository, signer workflow, source ref, and source revision constraints.
4. A dependency-free Node emitter reads trusted GitHub context and action
   outputs, re-parses the Trivy report, confirms its exact digest-pinned subject,
   derives all five severity counts, hashes the three fixed files, and writes
   the fixed candidate-evidence filename.
5. The pinned provenance action attests the four completed evidence files.
6. The canonical artifact upload runs only on success. A separate
   failure-only diagnostic upload uses a rejected-artifact name and cannot be
   selected as candidate evidence.
7. The existing handoff action validates and records the exact evidence artifact
   name, contract path, and evidence-package attestation URL alongside the
   immutable image candidate.

## 7. Alternatives Considered

### Inline workflow shell and handwritten JSON

- Pros: fewer repository files.
- Cons: duplicates the contract, is difficult to test, and weakens workflow
  reviewability.
- Decision: rejected.

### Archive the evidence package before attestation

- Pros: one attestable subject.
- Cons: adds archive creation and another extraction boundary while consumers
  already need the individual declared files.
- Decision: defer unless GitHub artifact semantics require it later.

### Local verification action plus dependency-free emitter

- Pros: testable trust boundary, no new dependency, and no project dependency
  execution in the write-privileged job.
- Cons: adds a small shell action and explicit runtime validation in JavaScript.
- Decision: recommended.

## 8. API / Interface Changes

- The publisher invokes the dependency-free emitter directly with the pinned
  repository Node version.
- `typecheck:automation` and `test:automation` validate automation independently;
  `test:unit` and `test:integration` remain service-only.
- A local provenance-verification action accepts the bundle path, exact candidate,
  GitHub token, and source revision; canonical repository, ref, and workflow
  policy remain fixed inside the action.
- The candidate-handoff action adds validated evidence artifact, contract path,
  and evidence attestation inputs and outputs.
- The successful security-evidence artifact adds the retained provenance bundle
  and `component-candidate-evidence-v1alpha1.json`.

## 9. Data Model / Persistence Changes

None. GitHub Actions artifacts and attestations remain short-lived CI evidence,
not application persistence.

## 10. Security, Privacy, and Abuse Considerations

- PR jobs retain `contents: read` and receive no package, attestation, or token
  write permission.
- All external actions remain pinned to full commit SHAs.
- The write-privileged publisher does not install or execute project
  dependencies; the emitter uses only Node built-ins.
- Bundle paths are quoted, required to be regular files, and constrained to
  `RUNNER_TEMP` before copying.
- `gh attestation verify` enforces repository, signer workflow, source ref,
  source digest, hosted runner, predicate type, and exact OCI subject.
- Untrusted Trivy JSON is independently parsed by the emitter, subject-bound,
  and rejected on malformed or unsupported severity data.
- The emitter validates environment-derived strings and cross-field bindings
  before writing the handoff document; repository tests parse successful output
  through the strict producer contract.
- Publication-time validation is intentionally duplicated at the privilege
  boundary: importing the Zod parser would execute project dependencies with
  package and attestation write permissions. Contract tests are the drift guard.

## 11. Performance, Scalability, and Reliability Considerations

The added work is local hashing, JSON serialization, and two attestation
operations over small evidence files. Docker publication and Trivy remain the
dominant costs. Every step fails closed, and workflow concurrency continues to
preserve active canonical `main` publication attempts.

## 12. Implementation Steps

1. Establish the automation source and test boundary.
   - Files: `automation/` configs and feature directories, package scripts, CI
     workflow, repository guidance.
   - Verification: service tests do not discover automation tests; the dedicated
     automation command and CI job do.
2. Add image-provenance retention and verification.
   - Files: new local composite action and shell behavior tests.
   - Verification: fake `gh` tests prove exact verification arguments and
     failure propagation.
3. Add dependency-free evidence emission.
   - Files: Node emitter and focused CLI tests.
   - Verification: report subject, severity counts, hashes, and identities match;
     malformed inputs emit no file.
4. Wire the canonical workflow and explicit handoff.
   - Files: emitter invocation, CI workflow, and repository workflow-contract
     tests.
   - Verification: ordering, permissions, exact paths, success-only canonical
     upload, evidence attestation, and failure diagnostics are asserted.
5. Run checks and repository-specific reviews.
   - Verification: `npm run check`, targeted shell/contract tests, diff check,
     and security/system/maintainability reviews.

## 13. Testing Strategy

- Subprocess-test bundle copying, exact `gh` arguments, path constraints, and
  verifier failure propagation.
- Subprocess-test evidence generation, report subject and severity validation,
  file hashes, semantic bindings, missing files, and no-output failure behavior.
- Subprocess-test the handoff's run-attempt evidence identities.
- Run all repository-helper tests through the dedicated automation Vitest
  configuration, never the service unit/integration commands.
- Extend workflow contract tests for permissions, action pinning, ordering,
  success-only handoff, evidence-package attestation, and rejected diagnostics.
- Run the full existing unit and integration suites.

## 14. Rollout / Migration Plan

The PR changes only the next canonical `main` publication. Rollback is a normal
revert PR. Previously published candidates retain their earlier evidence shape
and are not backfilled. The environment consumer must continue rejecting runs
that do not contain the supported contract artifact.

## 15. Risks and Mitigations

| Risk                                                   | Impact | Likelihood | Mitigation                                                     |
| ------------------------------------------------------ | -----: | ---------: | -------------------------------------------------------------- |
| Provenance verifies for the wrong workflow or revision |   High |        Low | Exact signer, repo, ref, revision, and subject flags           |
| Partial evidence is mistaken for a handoff             |   High |     Medium | Success-only canonical name; distinct rejected diagnostic name |
| Counts omit new or malformed severities                | Medium |        Low | Emitter re-parses the report and rejects unknown values        |
| Runner `gh` behavior changes                           | Medium |        Low | Fail closed and keep command contract tests                    |
| Workflow diff becomes difficult to review              | Medium |        Low | Thin actions, automation modules, explicit ordering tests      |
| Emitter and Zod contract drift                         | Medium |        Low | Parse emitted fixtures through Zod in required unit tests      |

## 16. Done Criteria

- Canonical `main` emits one schema-valid, content-addressed evidence document.
- Image provenance and the completed evidence package are independently
  attestable and identity-bound.
- Failed or incomplete runs emit no canonical evidence artifact or handoff.
- No PR permission or AWS behavior changes.
- Automation and service tests execute as separately visible CI concerns.
- Full local checks and repository reviews pass.

## 17. Review Checklist

- [x] Requirements and non-goals are explicit
- [x] Existing workflow and contract conventions were inspected
- [x] Alternatives were considered
- [x] Security and failure boundaries are explicit
- [x] Testing, rollout, and rollback are defined
- [x] Implementation steps name concrete files and verification

## 18. Handoff Prompt for Implementation Agent

```text
Implement docs/plans/emit-candidate-evidence.md in the reservation-service
repository. Keep the change service-only, dependency-free at publication time,
fail-closed, and within the merged v1alpha1 contract. Preserve exact-SHA action
pinning and PR permissions. Add the specified behavior and workflow-contract tests. Run
npm run check and stop before commit, push, or PR creation.
```
