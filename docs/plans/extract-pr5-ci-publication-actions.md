# Implementation Plan: Extract PR5 CI Publication Actions

## 1. Summary

Refactor the PR5 GHCR publisher so GitHub Actions YAML remains declarative and
the imperative candidate preparation and handoff logic lives in small,
repo-local composite actions backed by Bash. Preserve all reviewed publication,
permission, concurrency, digest, and attestation behavior while creating an
intentional migration seam for
[`movie-reservation-platform-lab/.github#5`](https://github.com/movie-reservation-platform-lab/.github/issues/5).

## 2. Goals

- Remove multi-line shell programs from `.github/workflows/ci.yml`.
- Give candidate preparation and handoff recording explicit inputs and outputs.
- Test success and failure behavior without contacting GitHub or GHCR.
- Keep the current PR5 artifact and security contract unchanged.
- Make the later move to a shared reusable workflow a narrow caller refactor.

## 3. Non-goals

- Implement the organization-wide reusable workflow in this repository.
- Generalize the publisher for static-site OCI artifacts or arbitrary registries.
- Change the five pull-request checks, hosted e2e scope, image platform, tag
  format, provenance contract, or downstream promotion ownership.
- Add a new runtime, shell-test framework, or GitHub Actions toolkit dependency.

## 4. Current State

`.github/workflows/ci.yml` contains three imperative concerns inside the
`publish-candidate` job: candidate identity construction, current-main
verification through `git ls-remote`, and digest validation plus summary
rendering. `test/unit/repository/standalone-extraction.test.ts` protects the
workflow through text-level policy checks but cannot execute those shell paths.

The repository already uses Vitest unit tests and Bash-capable Linux runners.
PR5 has been verified with the full repository CI, a local container build,
workflow parsing, formatting, and whitespace checks.

## 5. Requirements and Assumptions

### Confirmed Requirements

- Only a canonical-repository push to `main` may publish.
- Candidate tags remain attempt-unique.
- The immutable digest remains the downstream candidate identity.
- The source SHA must still equal current `main` before registry login/push.
- Provenance must attest the exact digest and be pushed to GHCR.
- Pull requests, forks, and manual runs remain read-only.

### Assumptions

- The publisher continues to run on an Ubuntu GitHub-hosted runner with Bash.
- `git`, `docker`, and official pinned actions remain workflow dependencies.
- The future shared workflow will preserve the same prepare/record conceptual
  boundary but may refine its public inputs after a second consumer is proven.

### Open Questions

None block this local refactor. The final cross-repository API, versioning, and
second pilot are owned by `.github#5` rather than this PR.

## 6. Proposed Design

Add two local composite actions:

1. `.github/actions/prepare-container-candidate/` validates the canonical event
   context, resolves the attempt-unique image identity, verifies the remote
   branch SHA, and exposes registry/repository/image/tag/build outputs.
2. `.github/actions/record-container-candidate/` validates the build digest and
   candidate metadata, records the immutable handoff in the step summary, and
   exposes the immutable reference as an output.

Each action delegates to one strict-mode Bash file. The workflow invokes the
actions around the existing pinned Docker and attestation actions. Vitest runs
the Bash scripts in subprocesses with temporary output files and a fake `git`
executable so both happy and rejection paths remain deterministic.

## 7. Alternatives Considered

### Alternative A: Move shell only to `scripts/ci/`

- Pros: Fewest new files and concepts.
- Cons: No typed GitHub Actions interface; the workflow still wires numerous
  environment variables and outputs manually.
- Decision: Rejected because composite action metadata is the intended future
  migration seam.

### Alternative B: Write TypeScript/JavaScript actions

- Pros: Richer unit testing and structured GitHub Actions APIs.
- Cons: Requires an action build/bundle lifecycle and dependencies for logic
  that is currently short, Linux-specific CLI glue.
- Decision: Defer until the shared implementation grows beyond maintainable
  Bash or requires GitHub API/structured-data behavior.

### Alternative C: Keep inline shell until the shared workflow exists

- Pros: No interim refactor.
- Cons: Leaves reviewed policy logic embedded in YAML and provides no executable
  local specification for the platform implementation.
- Decision: Rejected.

## 8. API / Interface Changes

The public service and GraphQL APIs do not change. The internal workflow gains
two local action interfaces. Preparation accepts the expected repository and
ref, then returns candidate metadata. Recording accepts that metadata plus the
published digest and writes the workflow summary.

## 9. Data Model / Persistence Changes

None.

## 10. Security, Privacy, and Abuse Considerations

- Validate all action inputs before writing GitHub output or Markdown files.
- Pass GitHub expressions through action inputs/environment variables, never as
  interpolated executable shell fragments.
- Preserve explicit job-level write permissions only on `publish-candidate`.
- Keep registry authentication after current-main admission.
- Do not log `GITHUB_TOKEN` or accept a long-lived credential.

## 11. Performance, Scalability, and Reliability Considerations

The actions add no network call beyond the existing `git ls-remote` and no new
dependency installation. A stale run still fails before registry login. If the
push succeeds but attestation or recording fails, the workflow remains red and
the digest remains ineligible, matching the existing operational contract.

## 12. Implementation Steps

1. Add composite action contracts and scripts.
   - Files: `.github/actions/prepare-container-candidate/*`,
     `.github/actions/record-container-candidate/*`.
   - Verification: Bash syntax checks and focused Vitest subprocess tests.
2. Refactor the publisher workflow.
   - File: `.github/workflows/ci.yml`.
   - Verification: YAML parsing, repository-policy unit tests, Prettier.
3. Add behavior-focused tests.
   - File: `test/unit/repository/ci-publication-actions.test.ts`.
   - Verification: success, stale source, invalid context, invalid digest, and
     summary/output assertions.
4. Update repository documentation and policy checks.
   - Files: `DEVELOPMENT.md`,
     `test/unit/repository/standalone-extraction.test.ts`.
   - Verification: `npm run test:unit`, `npm run format:check`, `git diff --check`.

## 13. Testing Strategy

- Bash syntax-check both scripts with `bash -n`.
- Unit-test preparation with a temporary `GITHUB_OUTPUT` and a fake `git` on
  `PATH` for matching and stale remote SHAs.
- Unit-test recording with temporary `GITHUB_OUTPUT`/`GITHUB_STEP_SUMMARY`
  files for valid and invalid digests.
- Keep workflow policy tests focused on orchestration, permissions, action
  pins, local action references, and the publish/attest data flow.
- Run the full local `npm run check` before handoff; rerun `npm run ci` if Docker
  is available and proportionate after the script-only refactor.

## 14. Rollout / Migration Plan

Merge the self-contained PR5 only after `main` protection requires the five PR
checks. Prioritize `.github#5` next. Once the central workflow has passed its own
tests and a second container pilot, replace these local action calls with a
full-SHA-pinned reusable workflow call. Reverting that consumer refactor restores
the known-good local implementation from Git history.

## 15. Risks and Mitigations

| Risk                                                    | Impact | Likelihood | Mitigation                                                                           |
| ------------------------------------------------------- | -----: | ---------: | ------------------------------------------------------------------------------------ |
| Local action behavior drifts from reviewed inline logic |   High |        Low | Preserve exact tags, gates, labels, digest, and summary contract in executable tests |
| Shell receives malformed values                         |   High |        Low | Validate context, identifiers, digest, and metadata before file output               |
| Tests accidentally contact GitHub                       | Medium |        Low | Replace `git` with a temporary deterministic fake                                    |
| Interim interface becomes premature platform API        | Medium |     Medium | Mark it repo-local and keep the shared contract in `.github#5`                       |

## 16. Done Criteria

- `ci.yml` contains no embedded multi-line Bash program.
- Both local actions have documented inputs/outputs and strict Bash scripts.
- Behavior tests cover accepted and rejected publication metadata.
- Existing publication, attestation, concurrency, and permission contracts pass.
- Documentation explains the local actions and future shared-workflow migration.
- `npm run check`, workflow parsing, formatting, and whitespace checks pass.

## 17. Review Checklist

- [x] Requirements are explicit
- [x] Non-goals are explicit
- [x] Existing code conventions were checked
- [x] Alternatives were considered
- [x] Security implications were reviewed
- [x] Scalability and reliability implications were reviewed
- [x] Testing strategy is complete
- [x] Rollout and rollback are defined
- [x] Implementation steps are ordered and concrete

## 18. Handoff Prompt for Implementation Agent

```text
Implement docs/plans/extract-pr5-ci-publication-actions.md.

Preserve all existing PR5 publication, attestation, concurrency, permission,
tag, digest, and handoff semantics. Do not implement the organization-wide
shared workflow in this repository. Add the two local composite actions,
behavior-focused Vitest subprocess coverage, workflow contract updates, and
documentation. Run the focused tests and npm run check before handoff.
```
