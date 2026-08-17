# Implementation Plan: Provisional Container Vulnerability Gate and Evidence

## 1. Summary

Issue #19 originally asked for a deliberately small Trivy evidence gate on the
exact container digest published from canonical `main`. The owner review on
2026-08-17 expands that design in one important way: pull requests must also
build and scan a local container, and a CRITICAL finding must prevent merge once
the new status check is enabled in the `main` ruleset.

The recommended design has two complementary paths:

- pull requests build one local container, scan its OS and application/library
  packages, show actionable CRITICAL details, upload the JSON report for 14
  days, and fail on any CRITICAL finding;
- canonical `main` continues to publish once, scans the exact GHCR digest,
  uploads a CycloneDX SBOM plus complete vulnerability JSON for 14 days, and
  records candidate handoff only when the scan and evidence gate pass.

Trivy observes the image and produces evidence. A small repository-owned
evaluator validates that the report belongs to the expected image, renders a
human-readable summary, and applies the provisional CRITICAL-only rule. The
evaluator responsibility is approved; the current 217-line AI-generated
`.mjs` prototype, its structure, and its language are not yet approved.

This is a service-local pilot with an explicit extraction seam. A separately
versioned CI-automation repository may later own reusable Trivy setup and
evaluation building blocks. `movie-platform-environments` consumes candidate
identity and evidence at admission/promotion boundaries; it does not own
application build mechanics.

## 2. Goals

- Prevent a pull request with a CRITICAL container vulnerability from merging
  after the stable scanner status is configured as a required check.
- Scan a locally built pull-request image without publishing it or granting the
  PR workflow registry-write credentials.
- Scan the exact immutable GHCR digest produced by canonical `main`.
- Scan operating-system and application/library vulnerabilities only.
- Include fixed and unfixed findings; every CRITICAL finding blocks.
- Give PR authors an actionable summary containing vulnerability ID, package,
  installed version, and fixed version when Trivy reports one.
- Upload complete PR vulnerability JSON for 14 days.
- Upload a CycloneDX JSON SBOM and complete vulnerability JSON for the published
  `main` digest for 14 days.
- Keep HIGH findings visible and non-blocking in this repository.
- Fail closed on scanner, vulnerability-database, registry, missing-report,
  malformed-report, and report-subject mismatch failures.
- Preserve existing build provenance, immutable candidate identity, and
  candidate handoff ordering.
- Pin every direct third-party GitHub Action to a full commit SHA.
- Keep the first implementation small enough for human review and make later
  extraction possible without treating the prototype as a platform API.

## 3. Non-goals

- Select the permanent platform scanner, policy engine, evaluator language, or
  shared-workflow API.
- Implement the future leadership-approved exception mechanism in this issue.
- Automatically allow unfixed CRITICAL findings.
- Implement downstream HIGH approval storage or claim that a live approval
  executor already exists.
- Attach signed SBOM or vulnerability attestations to the image digest.
- Retain evidence beyond 14 days.
- Add source, secret, IaC/configuration, license, or SARIF scanning.
- Add scheduled rescans or scan every platform repository.
- Add Dependabot, Renovate, or automated GitHub Action update policy.
- Publish temporary PR images or grant PRs GHCR write access.
- Automatically delete rejected GHCR candidates.
- Add a paid service, long-lived credential, AWS mutation, deployment, or
  environment promotion.
- Create the future CI-automation repository as part of issue #19.

## 4. Current State

### Repository workflow

`.github/workflows/ci.yml` runs quality, unit, integration, and build jobs. For
non-canonical events, `container-image-check` waits for all four jobs and only
executes `npm run docker:build`. On a canonical push to `main`,
`publish-candidate` builds and publishes a `linux/amd64` image, records GitHub
build provenance, and writes candidate handoff metadata for the exact digest.

The current uncommitted issue branch adds only the post-publication `main`
path. It does not scan pull-request images and therefore cannot satisfy the
owner's requirement that authors fix CRITICAL findings before merge.

### Existing prototype

The branch currently contains:

- two exact-digest Trivy invocations in `publish-candidate`;
- a 14-day artifact containing CycloneDX and vulnerability JSON;
- a repo-local `evaluate-container-vulnerabilities` composite action;
- a 217-line dependency-free `.mjs` evaluator;
- deterministic Trivy JSON fixtures and subprocess tests;
- text-level workflow contract assertions;
- README and DEVELOPMENT wording for the `main`-only behavior.

The prototype is fully AI-generated and unreleased. It is evidence for review,
not an approved implementation. In particular:

- its evaluator accepts only immutable GHCR references and cannot validate a
  local PR image;
- its summary reports counts but not the approved actionable finding details;
- its tests do not cover PR subjects, unfixed CRITICAL behavior, or the final
  required-check workflow;
- its documentation can be read as if downstream HIGH approval already exists;
- its `container-image-check` remains late and build-only.

### Cross-repository boundary

`movie-platform-environments` defines candidate admission, release selection,
and promotion policy around immutable digests. Its architecture explicitly
says that automation reused across repositories or needing independent
versioning should move to a separate utility repository or package. It also
states that Python is local to that repository, not a platform-wide mandate.

The private Programming KB reinforces the same boundary:

- `[[Multi-Service Release Composition]]` says each service independently
  builds, verifies, and publishes an immutable candidate plus evidence;
- `[[Environment Release Manifest]]` separates artifact creation in service
  repositories from exact artifact selection in environment control.

Repository files and the reviewed plan remain authoritative. The KB currently
has no dedicated reusable-GitHub-workflow or CI-building-block note.

### Issue baseline and approved steering

Issue #19 requires the exact published digest scan, CycloneDX and vulnerability
evidence, CRITICAL-only failure, visible HIGH findings, SHA-pinned actions, and
no paid service or long-lived credential. The owner review preserves those
requirements and adds the blocking local PR scan. The issue or PR description
must explicitly record this approved expansion so implementation and review do
not silently diverge from the original acceptance criteria.

## 5. Requirements and Assumptions

### Confirmed Requirements

- PR and canonical `main` scanning are both required.
- PRs scan one locally built image and never publish it.
- Canonical `main` scans exactly
  `${{ steps.image.outputs.image_ref }}@${{ steps.publish.outputs.digest }}`.
- The stable PR job name is `container-security-check`.
- The PR security job starts after `service-quality` and may run in parallel
  with unit, integration, and service-build jobs.
- CRITICAL findings, including unfixed CRITICAL findings, fail both PR and
  `main` policy evaluation.
- HIGH findings are reported but do not fail this repository's gate.
- The future environment admission process must record HIGH approval, but that
  mechanism is not implemented or represented as current functionality here.
- Scanner and evidence failures fail closed.
- During a prolonged integration outage, a controlled maintainer may
  temporarily remove the required-check ruleset entry. Evaluator code does not
  gain a fail-open switch.
- PR summaries show actionable CRITICAL details; the complete JSON report is a
  14-day artifact.
- The published digest receives CycloneDX and vulnerability JSON evidence for
  14 days.
- PR reports and `main` reports must be structurally valid and exactly bound to
  their expected scan subject.
- GHCR is an untrusted candidate registry. A rejected published image remains
  present for investigation but receives no candidate handoff.
- Trivy uses its current vulnerability data and update-aware caching. A report
  is point-in-time evidence and may change when vulnerability intelligence
  changes.
- Direct third-party actions remain exact-SHA pinned with readable release
  comments.
- Tests prove local policy and workflow wiring; they do not retest Trivy or
  depend on a live vulnerability database.
- README, DEVELOPMENT, and the plan distinguish implemented behavior from
  future platform capabilities.

### Assumptions

- `npm run docker:build` continues to produce the stable local image reference
  `movie-reservation-service:local`; implementation must verify this rather
  than introduce a second build command.
- GitHub-hosted PR runners are ephemeral and receive only `contents: read`.
- The existing canonical publisher retains its current least-privilege
  `packages`, `id-token`, and `attestations` permissions.
- Normal Trivy database update behavior is acceptable. Caching is a performance
  optimization, not permission to silently use an invalid database.
- Fourteen days is intentionally short-lived diagnostic/release evidence, not
  an audit-retention promise.
- The first implementation remains repository-local until another service or
  independent versioning creates a concrete extraction need.
- The job topology is provisional and will be reconsidered using measured CI
  duration, runner cost, and failure timing.

### Open Questions

- Which language and internal structure should replace or refactor the current
  AI-generated `.mjs` evaluator? The choice must consider current repository
  reviewability and future standalone-action portability. It is an approval
  checkpoint before implementation, not an implicit endorsement of Node.js.

### Approved Delivery Shape

Deliver the work through four sequential, human-reviewable PRs:

1. reviewed plan only;
2. evaluator contract, approved implementation/refactor, fixtures, and behavior
   tests;
3. pull-request `container-security-check`, PR evidence upload, workflow tests,
   and PR-facing documentation;
4. canonical `main` exact-digest SBOM/report gate, handoff ordering, release
   tests, and release-facing documentation.

Use separate Git worktrees and branches so each PR has an isolated worktree and
small diff. Keep the current dirty issue branch unchanged as the raw reference
until every intended change has been safely ported and reviewed.

The following are named follow-ups, not blocking questions for the provisional
gate:

- design a leadership-approved, time-limited exception contract scoped to an
  exact CVE, package, image, justification, owner, compensating controls, and
  expiry;
- reconsider durable signed evidence attached to the image and long-term
  retention;
- create a separately versioned CI-automation repository when reuse is proven;
- choose that shared building block's language and distribution model;
- reconsider PR job topology from measured CI data;
- add automated action-update PR governance;
- evaluate secret, configuration/IaC, license, and other scan types separately.

## 6. Proposed Design

### 6.1 Pull-request path

Rename `container-image-check` to the stable `container-security-check` and
make it depend only on `service-quality`. Keep `contents: read` and do not add
secrets or registry permissions.

The job performs this sequence:

1. Check out the PR revision and set up the repository's Node.js toolchain.
2. Build `movie-reservation-service:local` once through
   `npm run docker:build`.
3. Create a dedicated evidence directory.
4. Run the SHA-pinned Trivy action against the local image with
   `scanners: vuln`, `vuln-type: os,library`, all severities preserved,
   unfixed findings included, normal database updates enabled, and a bounded
   timeout.
5. Write complete Trivy JSON. Trivy evidence generation does not own the final
   policy decision.
6. Evaluate the report against the exact local image subject, write actionable
   finding details and counts to the job summary, and exit non-zero when any
   CRITICAL finding exists.
7. Upload the complete JSON report for 14 days even after a CRITICAL policy
   failure. A missing report remains an error.

Do not generate CycloneDX for every PR. The PR path is an enforcement and
diagnostic signal; release evidence belongs to the actual published digest.

### 6.2 Canonical `main` path

Preserve the existing publish-once workflow and provenance attestation. After
publication and provenance, but before candidate handoff:

1. Generate CycloneDX JSON for the exact `${image_ref}@${digest}`.
2. Generate full vulnerability JSON for that same exact reference.
3. Evaluate and validate the report against that immutable subject.
4. Upload both reports for 14 days even after a CRITICAL policy failure.
5. Run `record-container-candidate` only when scanning, evaluation, and upload
   succeed and CRITICAL count is zero.

A rejected digest remains in GHCR. Its presence is not approval, and it must
not be deleted automatically or selected downstream.

### 6.3 Provisional evaluator contract

Keep the evaluator behind one repo-local action so workflow YAML remains
orchestration rather than policy code. The implementation language remains an
approval checkpoint, but the behavior and boundary are fixed.

Inputs:

- `report-path`: workspace-relative Trivy JSON path;
- `expected-image`: exact local tag or immutable GHCR digest reference;
- `subject-kind`: a closed value such as `local` or `immutable-ghcr`;
- `evidence-artifact-name`: the report artifact authors can download.

Outputs:

- `high-count`;
- `critical-count`;
- `policy-result` (`passed` or `failed`).

Runtime validation must:

- reject missing inputs and invalid subject syntax;
- resolve the report path inside `GITHUB_WORKSPACE` and reject path/symlink
  escape;
- parse untrusted JSON and minimally validate Trivy schema version, container
  artifact type, result collections, vulnerability collections, and fields
  used by policy/summary logic;
- require `ArtifactName` to equal `expected-image` exactly;
- preserve all severity findings while counting HIGH and CRITICAL;
- render CRITICAL vulnerability ID, package, installed version, and fixed
  version or an explicit `no fix reported` marker;
- prevent report-controlled Markdown or workflow-command injection;
- write summary and outputs before exiting non-zero for policy failure;
- fail closed without producing a false pass for malformed or mismatched
  evidence.

TypeScript types, if selected, improve implementation review but do not replace
runtime validation of Trivy JSON.

### 6.4 Required-check activation

Workflow YAML alone cannot prevent merge. `container-security-check` becomes a
real gate only after its exact stable status name is configured as required in
the canonical repository's `main` ruleset.

Ruleset mutation is a separately authorized administrative release step. It is
not performed as an incidental code edit.

### 6.5 Future extraction seam

The local action's small input/output contract is the candidate seam for a
future CI-automation repository. Extraction should move scanner setup,
evidence conventions, and reusable policy evaluation behind a versioned,
commit-pinned consumer interface. It must not move application publication
ownership into `movie-platform-environments` or turn Python into a platform
mandate.

### 6.6 Four-PR worktree delivery

Use a sequential branch chain with one worktree per PR. Suggested branch roles
are:

| PR  | Suggested branch                  | Base                                        | Scope                                                                                    |
| --- | --------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | `issue-19-plan`                   | canonical `main`                            | This reviewed plan only                                                                  |
| 2   | `issue-19-evaluator`              | PR 1 after merge, or PR 1 branch if stacked | Approved evaluator, local action contract, fixtures, and evaluator tests                 |
| 3   | `issue-19-pr-security-gate`       | PR 2 after merge, or PR 2 branch if stacked | PR build/scan/report gate, workflow contracts, and PR documentation                      |
| 4   | `issue-19-main-security-evidence` | PR 3 after merge, or PR 3 branch if stacked | Published-digest SBOM/report gate, handoff ordering, release contracts, and release docs |

Prefer merging sequentially and creating/rebasing each next branch from the
new canonical `main`; this produces the clearest GitHub diff. Stacking is
acceptable when parallel review matters, but each PR must target its immediate
predecessor until that predecessor merges, then be retargeted/rebased without
mixing scopes.

The current dirty `issue-19-provisional-container-security-evidence` worktree is
the source reference only. Do not reset, delete, or reuse its branch in another
worktree. Before any cleanup, verify that every approved hunk exists in one of
the four branches and that untracked fixtures/action files have also been
ported.

The temporary unused evaluator between PR 2 and PR 3 is an accepted staging
tradeoff: isolating security policy code for review is more valuable here than
avoiding a short-lived unused internal action.

## 7. Alternatives Considered

### Alternative A: Scan only canonical `main`

- Pros: Original issue scope and smallest workflow change.
- Cons: Finds vulnerabilities after merge and does not hold the author
  accountable through branch protection.
- Decision: Rejected by owner review. Keep the exact-digest scan and add the
  blocking local PR scan.

### Alternative B: Publish a temporary PR image

- Pros: PR evaluation can use a registry digest.
- Cons: Requires write credentials for untrusted PRs, registry cleanup, and
  more complex fork behavior.
- Decision: Rejected. Scan the local PR image.

### Alternative C: Let Trivy alone enforce the exit code

- Pros: Less repository-owned policy code.
- Cons: Does not provide the approved report validation, exact subject binding,
  tailored summary, or a clean extension seam for governed exceptions.
- Decision: Rejected. Keep a small testable evaluator, but do not approve the
  current prototype without review/refactor.

### Alternative D: Put parsing policy inline in YAML/shell

- Pros: Fewer files.
- Cons: Harder to test, easy to make brittle, and poor for future extraction.
- Decision: Rejected.

### Alternative E: Create the shared CI repository now

- Pros: Demonstrates reusable platform building blocks immediately.
- Cons: Expands a provisional service gate into a cross-repository API before a
  second consumer has proven the interface.
- Decision: Deferred. Keep an extraction seam and create a named follow-up.

### Alternative F: Store reusable scanning in `movie-platform-environments`

- Pros: One apparent place for release automation.
- Cons: Mixes build mechanics with environment selection/admission ownership.
- Decision: Rejected based on the environment-control contract.

### Alternative G: Attach durable signed evidence now

- Pros: Stronger long-term identity, auditability, and downstream verification.
- Cons: Prematurely selects the evidence predicate, signing, retention, and
  consumer contract.
- Decision: Deferred. Use 14-day workflow artifacts for the pilot.

### Alternative H: Ignore unfixed CRITICAL findings

- Pros: Avoids deadlock when vendors have no patch.
- Cons: Creates a broad unaudited exception based only on fix availability.
- Decision: Rejected provisionally. Block all CRITICAL findings and design a
  governed exception workflow later.

## 8. API / Interface Changes

There are no GraphQL, HTTP, domain, application, or persistence API changes.

The internal CI interface changes are:

- stable required status: `container-security-check`;
- provisional evaluator inputs and outputs described in section 6.3;
- PR artifact containing a complete vulnerability JSON report;
- `main` artifact containing stable CycloneDX and vulnerability JSON file
  names;
- workflow summary containing subject, counts, policy result, artifact name,
  and actionable CRITICAL details.

These are repository-local alpha interfaces. Downstream repositories must not
treat the action path or file shape as a platform API until extraction is
designed and versioned.

## 9. Data Model / Persistence Changes

None for the service database.

GitHub Actions retains per-run evidence for 14 days. No backfill is performed
for existing images. The same image may receive a different result later as the
vulnerability database changes; every report is bound to its scan subject and
workflow run/attempt.

## 10. Security, Privacy, and Abuse Considerations

- PR scanning runs without secrets, package writes, ID tokens, or AWS access.
- Untrusted fork code runs only on an ephemeral GitHub-hosted runner with
  `contents: read`.
- Canonical publication retains its existing short-lived `GITHUB_TOKEN` and
  least-privilege job permissions.
- `main` scans the immutable digest, never the mutable discovery tag.
- The evaluator rejects wrong-subject, path-escape, malformed, incomplete, and
  non-container reports.
- External report strings are constrained/escaped before entering Markdown,
  outputs, or error messages.
- Unfixed CRITICAL findings remain blocking until a governed exception exists.
- A controlled ruleset override is an administrative emergency action, not a
  hidden workflow input.
- Direct actions are commit-SHA pinned. Updating a pin requires a reviewed PR.
- Artifacts contain package and vulnerability inventory, not secrets. The
  workflow does not enable secret scanning or print the full report into logs.
- A published rejected image remains untrusted and receives no handoff. No
  destructive registry cleanup is automated.

## 11. Performance, Scalability, and Reliability Considerations

- PR build and scan run after `service-quality` in parallel with remaining
  service jobs, improving time-to-security-feedback at the cost of concurrent
  runner use.
- The PR image is built once in its security job. Cross-job Docker image
  transfer and duplicate PR image publication are avoided.
- `main` runs separate CycloneDX and vulnerability output passes because the
  evidence formats have different purposes. Reuse one installed Trivy binary
  and database within the job where supported.
- Do not configure offline or skip-update behavior that silently weakens
  freshness. A database outage fails closed.
- Trivy invocations and jobs retain explicit timeouts.
- New vulnerability intelligence may turn an unchanged image red. This is
  expected security behavior, not nondeterminism in evaluator tests.
- Measure PR duration, queueing, download volume, and failure timing. Revisit
  whether security should remain in one job or become a shared reusable job.

## 12. Implementation Steps

1. Record the approved scope expansion.
   - Change: Update the issue/PR narrative to state that PR scanning and a
     required status are owner-approved additions to issue #19.
   - Files/modules likely affected: PR description or issue comment; no source
     file is required unless authorized separately.
   - Notes: Do not mutate GitHub state without explicit authorization.
   - Verification: reviewer can trace every implemented behavior to this plan.

2. Resolve the evaluator implementation checkpoint.
   - Change: Review the AI-generated evaluator, select/refactor its language and
     internal structure, and preserve the approved runtime contract.
   - Files/modules likely affected:
     `.github/actions/evaluate-container-vulnerabilities/`, `scripts/` if a
     typed core is selected, `eslint.config.mjs`, `tsconfig.json` only if needed.
   - Notes: Prefer the smallest implementation that is readable, testable, and
     compatible with the current local workflow. Do not optimize prematurely
     for the future shared repository.
   - Verification: focused evaluator tests, lint, and typecheck where applicable.

3. Rewrite evaluator tests around approved behavior.
   - Change: Add deterministic fixtures and tests for PR/local and `main`/digest
     subjects, HIGH-only, zero, fixed/unfixed CRITICAL, malformed structure,
     wrong subject, invalid artifact type/schema, missing files, and actionable
     summary details.
   - Files/modules likely affected:
     `test/fixtures/security/`,
     `test/unit/repository/container-security-evidence.test.ts`.
   - Notes: Test our policy and trust boundary, not Trivy internals.
   - Verification:
     `npm exec -- vitest run test/unit/repository/container-security-evidence.test.ts`.

4. Convert the PR image check into the security gate.
   - Change: Rename the job to `container-security-check`, depend only on
     `service-quality`, build the local image once, produce/evaluate JSON, and
     upload the report for 14 days after policy failure.
   - Files/modules likely affected: `.github/workflows/ci.yml`.
   - Notes: Preserve read-only permissions and fork compatibility. Do not
     publish the image or generate a PR CycloneDX SBOM.
   - Verification: workflow contract tests and a real non-required PR run.

5. Reconcile the canonical `main` evidence path.
   - Change: Keep exact-digest CycloneDX and JSON generation, adapt the evaluator
     to the approved subject interface, preserve 14-day upload-after-policy-
     failure, and keep handoff last.
   - Files/modules likely affected: `.github/workflows/ci.yml`, evaluator action.
   - Notes: A CRITICAL result leaves a rejected image in GHCR without handoff.
   - Verification: exact digest assertions and hosted canonical run after merge.

6. Refocus workflow contract tests.
   - Change: Assert stable job name, PR/local target, main/digest target, scan
     scope, SHA pins, artifact contents/retention, fail-closed ordering, and
     handoff prevention without coupling every assertion to YAML formatting.
   - Files/modules likely affected:
     `test/unit/repository/standalone-extraction.test.ts` or a focused workflow
     contract test file.
   - Notes: Do not add a live Trivy scan to Vitest.
   - Verification: `npm run test:unit`.

7. Correct documentation by audience.
   - Change: Keep README concise; put rerun, evidence, rejection, ruleset,
     rollback, and operational failure details in DEVELOPMENT; keep unbuilt
     platform capabilities and follow-ups explicit in this plan.
   - Files/modules likely affected: `README.md`, `DEVELOPMENT.md`, this plan.
   - Notes: Do not claim downstream HIGH approval or a shared CI repository is
     already implemented.
   - Verification: `npm run format:check` and human documentation review.

8. Run local verification.
   - Change: Run focused checks, then the repository-required full check.
   - Files/modules likely affected: only fixes found by verification.
   - Notes: No push, merge, ruleset change, or deployment is authorized by this
     plan alone.
   - Verification: `npm run check`, `git diff --check`, `git status --short`.

9. Activate the required check in stages.
   - Change: Observe a successful PR run with the final job name, configure that
     exact status as required, then verify another PR cannot merge while the
     check is incomplete or failing.
   - Files/modules likely affected: GitHub `main` ruleset, outside the worktree.
   - Notes: Requires explicit administrative authorization.
   - Verification: branch-protection UI/API evidence and a real PR check.

## 13. Testing Strategy

### Deterministic evaluator tests

- HIGH-only reports pass and remain visible.
- Zero-finding reports pass.
- Fixed and unfixed CRITICAL reports fail after writing outputs and summary.
- Local PR subjects and immutable GHCR subjects are accepted only in their
  declared mode.
- Wrong image, wrong digest, wrong artifact type, unsupported schema, malformed
  JSON/collections, missing report, and workspace/path escape fail closed.
- Summary entries include vulnerability ID, package, installed version, fixed
  version or `no fix reported`, and the evidence artifact name.
- Report-controlled strings cannot inject Markdown or GitHub commands.

### Workflow contract tests

- `container-security-check` is present on PR/non-canonical execution and has
  read-only permissions.
- It builds and scans one local image without registry publication.
- Canonical `main` scans the exact published digest for both outputs.
- Both paths use `vuln` plus `os,library` and include unfixed findings.
- Direct actions are exact-SHA pinned.
- PR JSON and main JSON/CycloneDX artifacts use 14-day retention.
- Evidence upload runs after policy failure; candidate handoff does not.
- Existing publication, provenance, concurrency, and stale-main protections
  remain intact.

### Hosted rollout verification

- Run the real PR scanner once before making it required.
- Confirm the job summary and downloadable JSON are useful to an author.
- After merge, confirm the `main` artifact contains both files for the exact
  digest and that eligible handoff follows the security gate.

### Explicitly excluded tests

- Do not run a live Trivy database scan in Vitest.
- Do not attempt to make changing CVE data a deterministic unit fixture.
- Application GraphQL, database, and e2e behavior is unchanged; existing suites
  remain regression checks rather than new security test targets.

## 14. Rollout / Migration Plan

1. Preserve the current dirty branch as the raw reference; do not reset or
   delete it.
2. Create an isolated PR-1 worktree from canonical `main` and port only this
   plan.
3. Obtain explicit approval for the evaluator language/structure.
4. Create PR 2 from the updated base and port/refactor only the evaluator,
   action contract, fixtures, and behavior tests.
5. Create PR 3 from the updated base and add `container-security-check`, PR
   artifact upload, workflow contract tests, and PR documentation.
6. Run `container-security-check` on PR 3 while it is not yet required and
   stabilize the final check name.
7. After PR 3 merges, and with explicit authorization, add the stable status to
   the `main` ruleset and verify a new/refreshed PR is blocked while pending or
   failing.
8. Create/retarget PR 4 onto the protected base and add the canonical `main`
   exact-digest SBOM/report gate, handoff ordering, tests, and release docs.
9. Observe the first canonical `main` exact-digest scan and evidence artifact.
10. Compare all four merged scopes with the raw reference before removing any
    old worktree or branch.

Rollback has two layers:

- Integration emergency: a controlled maintainer temporarily removes the
  required status from the ruleset. The evaluator remains fail closed.
- Code rollback: revert the workflow, evaluator, tests, and docs. Do not delete
  published images or historical artifacts. Rejected candidates remain
  ineligible because they have no successful handoff.

## 15. Risks and Mitigations

| Risk                                           | Impact | Likelihood | Mitigation                                                                                        |
| ---------------------------------------------- | -----: | ---------: | ------------------------------------------------------------------------------------------------- |
| Workflow exists but is not required            |   High |     Medium | Treat ruleset activation and verification as release done criteria                                |
| New required status locks every PR             |   High |        Low | Run it successfully before adding the exact stable status to the ruleset                          |
| PR report is copied from another image         |   High |        Low | Bind report `ArtifactName` exactly to the expected local/digest subject                           |
| Unfixed CRITICAL finding blocks indefinitely   |   High |     Medium | Accept strict pilot behavior; design narrow leadership-approved exceptions later                  |
| Scanner/database outage blocks merge           | Medium |     Medium | Fail closed, rerun transient failures, use controlled ruleset rollback only for prolonged outages |
| AI-generated evaluator contains subtle defects |   High |     Medium | Treat it as unapproved; refactor/rewrite after behavior contract and fixture review               |
| Report content injects summary/workflow syntax |   High |        Low | Runtime-validate and escape every external string used in GitHub files                            |
| PR local build differs from final main build   | Medium |     Medium | Keep the exact published-digest scan as the release authority                                     |
| HIGH approval is described as implemented      |   High |     Medium | State it as future downstream policy; do not emit a fake approval record                          |
| Action reference moves or is compromised       |   High |        Low | Pin direct actions to reviewed commit SHAs and update only through PR review                      |
| Evidence expires before later audit            | Medium |     Medium | State 14-day limitation; follow up with signed image-linked long-term evidence                    |
| Reusable abstraction is extracted too early    | Medium |     Medium | Keep a narrow local seam; extract after a second consumer or independent versioning need          |
| Parallel security job increases CI cost        |    Low |     Medium | Measure duration/cost and revisit topology as a named follow-up                                   |
| Rejected image remains public in GHCR          | Medium |        Low | Treat registry as untrusted candidates; no handoff, no automatic selection, retain evidence       |

## 16. Done Criteria

### Implementation complete

- PRs build and scan one local container in `container-security-check`.
- CRITICAL findings, including unfixed findings, fail PR and `main` evaluation.
- PR authors receive actionable details plus a complete 14-day JSON report.
- Canonical `main` produces 14-day CycloneDX and vulnerability JSON for the
  exact published digest.
- Reports are structurally validated and exactly bound to their scan subject.
- Scanner/evidence failures fail closed.
- HIGH findings are visible and non-blocking without claiming an implemented
  approval mechanism.
- Candidate handoff occurs only after successful exact-digest evidence and no
  CRITICAL findings.
- Rejected GHCR images are not deleted or handed off.
- New direct actions are exact-SHA pinned.
- Evaluator and workflow tests cover the approved boundary without retesting
  Trivy.
- README and DEVELOPMENT accurately separate current and future behavior.
- `npm run check` and `git diff --check` pass.

### Operationally released

- A real PR run succeeds with the final stable status name.
- `container-security-check` is required by the canonical `main` ruleset.
- A PR is demonstrably blocked while that check is pending or failing.
- The first canonical exact-digest run produces downloadable evidence and only
  records an eligible candidate after the gate passes.

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
- [ ] Evaluator implementation/language is approved
- [x] Human-reviewable PR boundaries are approved

## 18. Handoff Prompt for Implementation Agent

Do not use this prompt until the remaining unchecked evaluator decision above
is resolved.

```text
Implement the approved plan in
docs/plans/add-provisional-container-security-evidence.md.

Constraints:

- Do not implement beyond the approved provisional scope.
- Add a blocking local PR image scan and preserve the canonical exact-digest
  scan.
- Scan only OS and application/library vulnerabilities.
- Block every CRITICAL finding, including unfixed findings; report HIGH without
  blocking.
- Fail closed on scanner, database, registry, missing, malformed, or mismatched
  evidence.
- Keep PR permissions read-only and do not publish PR images.
- Upload PR JSON and main JSON/CycloneDX evidence for 14 days.
- Keep candidate handoff after exact-digest evaluation and evidence upload.
- Treat the current AI-generated evaluator as a prototype. Use only the
  evaluator implementation/language approved in the completed plan.
- Preserve the approved four-PR boundaries. Do not combine plan, evaluator,
  PR-gate, and canonical-main scopes into one review.
- Use isolated worktrees/branches and keep the dirty raw branch untouched until
  all intended tracked and untracked changes are safely ported.
- Keep evaluator inputs/outputs narrow enough for later CI-building-block
  extraction without creating that shared repository now.
- Do not add paid services, long-lived credentials, source/secret/IaC/license
  scanning, SARIF, automated waivers, action-update automation, AWS changes, or
  downstream approval state.
- Pin direct third-party actions to exact commit SHAs.
- Test our evaluator and workflow contract with fixtures; do not retest Trivy.
- Do not push, merge, mutate rulesets, deploy, promote, or change shared
  environment state without explicit authorization.
- If implementation reality differs from the plan, stop and update the plan or
  ask for approval before changing scope.

Relevant files/modules:

- .github/workflows/ci.yml
- .github/actions/evaluate-container-vulnerabilities/
- test/unit/repository/container-security-evidence.test.ts
- test/fixtures/security/
- test/unit/repository/standalone-extraction.test.ts
- eslint.config.mjs and/or tsconfig.json only if the approved evaluator requires it
- README.md
- DEVELOPMENT.md

Expected verification commands:

- npm exec -- vitest run test/unit/repository/container-security-evidence.test.ts
- npm run test:unit
- npm run check
- git diff --check
- git status --short
```

## 19. Hosted Gate Baseline Remediation Addendum (2026-08-17)

### Finding and approved steering

The first real `container-security-check` run correctly rejected the existing
`node:24-bookworm-slim` runtime with six CRITICAL findings. The uploaded report
contained four unfixed `perl-base` findings, one `zlib1g` finding marked
`will_not_fix`, and one fixable `tar` finding inherited from npm in the Node
base image. Updating Debian 12 cannot make this runtime pass the approved
all-CRITICAL gate.

The owner approved a production/debug target split:

- the default scanned and published `runtime` target uses a digest-pinned
  Distroless Node 24 Debian 13 `nonroot` image and starts Node directly;
- build, production-dependency, and local `runtime-debug` targets use the same
  digest-pinned Node 24 Debian 13 slim base for ABI compatibility;
- local Docker Compose explicitly builds `runtime-debug`, preserving a normal
  Debian shell and npm for developer troubleshooting;
- the vulnerable debug target is local-only and must not be scanned as the
  candidate, published, or deployed;
- the runtime keeps only the compiled service, production dependencies, and
  `package.json`, which is required by service metadata and schema-root
  discovery;
- the runtime workspace remains writable by the non-root user until generated
  GraphQL schema output is separately hardened;
- no CVE ignore, waiver, fail-open switch, or exception mechanism is added.
  The governed exception lifecycle remains future platform work under
  organization `.github#8` and the reusable implementation seam under
  `.github#10`.

This remediation is an approved implementation-reality correction to PR 3:
the new required check cannot be activated successfully while the inherited
runtime baseline is known to violate its policy.

### Alternatives and decision

- `apt-get upgrade`: rejected because Debian has no fix for the blocking Perl
  findings and marks the zlib finding `will_not_fix`.
- Node 24 Debian 13 slim runtime: rejected for publication because a current
  one-off scan still reported four Perl findings plus npm's fixable `tar`.
- Alpine runtime: rejected for now because it changes glibc to musl and still
  inherited npm's `tar` finding.
- Ad hoc Trivy ignores: rejected because the approved exception governance does
  not exist yet.
- Distroless Debian 13 nonroot: selected because it preserves glibc/Debian
  compatibility, removes unused shell/package-manager/npm content, defaults to
  least privilege, and had zero CRITICAL base findings in the one-off
  comparison scan. The complete application image must still be scanned.

### Implementation and verification

1. Refactor `Dockerfile` into pinned build, production-dependency,
   runtime-layout, `runtime-debug`, and final `runtime` stages.
2. Make `npm run docker:build` explicitly select `runtime`; add a separate
   debug-image command and point local Compose at `runtime-debug`.
3. Extend repository contract tests for the pinned bases, explicit targets,
   non-root users, direct production Node startup, and local-only debug target.
4. Update README and DEVELOPMENT with the production/debug boundary, digest
   update responsibility, and Distroless debugging tradeoff.
5. Build the complete `linux/amd64` runtime image, verify its configured user,
   start it with the in-memory local profile, and exercise `/health`.
6. Run the same Trivy vulnerability scope against the complete local image and
   require zero CRITICAL findings.
7. Run focused repository tests, `npm run check`, and `git diff --check`.

Rollback is a reviewed revert to the prior Node slim runtime. Such a rollback
will make the security gate red again and therefore also requires temporarily
withholding or removing the required-check ruleset entry; it does not justify
silently weakening evaluator policy.
