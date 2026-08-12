# Implementation Plan: Stabilize Standalone Reservation Service Extraction

> **Status:** Approved by the owner on 2026-08-12. Local implementation of PR 1
> is authorized; commit, push, PR creation, publication, deployment, and other
> shared-state mutation still require their separately defined checkpoints.

## 1. Summary

Issue #1 is primarily an extraction-parity task: identify the reservation
service material that belongs in the original golden-path monorepo and carry it
into this standalone repository while removing only monorepo-specific paths and
assumptions.

The owner review retained source-parity adaptations, service-local developer
experience, focused CI jobs, a read-only PR image build, and main-only GHCR
candidate publication with provenance. It removed the unrelated container
hardening and observability-test rewrite, recorded explicit follow-ups, divided
the work into five human-reviewable PRs, and sequenced the first release. The
plan and follow-up issue map are approved; implementation proceeds only through
the explicit checkpoint for each PR slice.

## 2. Goals

- Use `golden-path-ecs-template@b9f33ad` as the authoritative extraction
  baseline.
- Inventory reservation-service code, tests, local-development assets,
  documentation, and CI behavior from that baseline.
- Transfer missing service-owned material into this repository, adapting only
  workspace and monorepo-root assumptions required by the standalone layout.
- Make `npm ci`, repository scripts, documentation, TypeScript compilation,
  tests, and the inherited Docker build operate from this repository root.
- Preserve existing reservation, GraphQL, persistence, migration,
  observability, and runtime behavior unless a source-parity adaptation makes a
  narrowly documented change unavoidable.
- Confirm the application-image boundary expected by the platform repositories
  without adding deployment or promotion responsibilities here.
- Preserve the golden-path service as a compatibility reference until hosted CI
  and an authorized AWS smoke deployment pass.

## 3. Non-goals

- No GraphQL, reservation-domain, authentication, persistence schema,
  migration logic, retry, worker, or observability behavior changes unless
  required to preserve behavior after a standalone path adaptation.
- No standalone-only container hardening, compiled-migration redesign,
  schema-output redesign, or unrelated test refactor. The explicitly approved
  CI publication controls are in scope; other CI redesign is not.
- No committed tool-specific AI projections. Preserve the original repository
  model: `.ai/` is the reviewed source of truth, `.ai/sync.sh` generates local
  projections, root `AGENTS.md` is generated and tracked, and the tool-specific
  output directories are gitignored.
- No AWS resource, ECR, environment-manifest, promotion, deployment, or
  automated package-visibility mutation from the service implementation. The
  explicitly authorized one-time GHCR visibility bootstrap and manual
  environment-owned admission/smoke procedure are release operations outside
  the service PRs.
- No frontend checks or Playwright strategy from
  `golden-path-ecs-template#31`.
- No Apollo Server upgrade, dependency audit remediation, SBOM generation, or
  separately managed signing-key system. GitHub build-provenance attestation
  for the published image is part of the approved candidate contract.
- No deletion or modification of the golden-path source copy.
- No commit, push, pull request creation, or shared-environment smoke run.

## 4. Planning Snapshot (2026-08-12)

These observations record the repository and sibling-contract evidence used for
the owner review. They are a dated planning snapshot, not live operational
status; each PR must revalidate the facts relevant to its slice.

- The branch is `issue-1-stabilize-standalone-extraction` at the same commit as
  `main`, with existing uncommitted edits in CI, documentation, package scripts,
  service metadata, local Compose/observability files, and generated AI
  guidance.
- `package.json` has a standalone `package-lock.json` and root-relative scripts.
  The local and Compose e2e scripts already reference
  `./node_modules/vitest/vitest.mjs` instead of the former parent workspace.
- `Dockerfile` already installs from the root lockfile, but the standalone
  `Dockerfile.dockerignore` lost the monorepo's allowlist. Consequently
  `COPY . .` currently admits tests, scripts, documentation, and local tooling
  that the `b9f33ad` image never received; the general TypeScript build can then
  compile tests and scripts into `dist/`.
- `.github/workflows/ci.yml` currently collapses code validation into
  `npm run ci`, then uses separate read-only and publishing image jobs. The
  unapproved implementation still uses a custom metadata parser and behavioral
  smoke, publishes a mutable source-only tag, lacks attestation permissions,
  and does not explicitly constrain publication to the canonical repository.
- `README.md` and `DEVELOPMENT.md` have removed the known `npm -w` and
  `../docs` assumptions. A repository scan found one remaining misleading
  monorepo path in the `src/service-metadata.ts` validation error.
- The environment catalog expects the candidate repository
  `ghcr.io/movie-reservation-platform-lab/movie-reservation-service` and an
  immutable `sha256` digest. At `movie-platform-environments@0de8407`, the
  release contract also requires source repository, full source commit SHA, and
  GitHub Actions run URL as candidate provenance. Infrastructure later consumes
  a separately admitted private ECR image by digest; it must not build this
  sibling source.
- `docker compose config --quiet` passes with Docker 29.1.2.
- The initial `npm run check` stops at formatting because locally generated AI
  projections are not yet covered by the original monorepo's ignore rules.
  They are generated from `.ai/`, must not be reviewed or edited independently,
  and disappear from the tracked/review surface once the baseline ignore model
  is restored.
- No hosted Actions run exists for the unpushed branch, so hosted CI and first
  GHCR publication remain operational gates after this local implementation.

## 5. Requirements and Assumptions

### Owner Decisions

1. **Scope:** Issue #1 is a strict extraction-parity task. Its main purpose is
   to carry reservation-service material from the original monorepo into this
   repository and adapt it to the standalone layout. Unrelated redesign or
   hardening requires separate approval.
2. **Source baseline:** Use `golden-path-ecs-template@b9f33ad` as the
   authoritative snapshot. Classify each divergence as a required standalone
   adaptation, a separately approved post-extraction improvement, or an
   unnecessary divergence to remove.
3. **Artifact ownership:** This service repository builds, tests, and publishes
   candidate artifacts. It does not admit, promote, mirror, select for an
   environment, or deploy those artifacts.
4. **Candidate registry:** Publish service candidates to GHCR. The service
   repository does not know or encode the candidate's final registry,
   environment, or deployment destination.
5. **Publication trigger:** Publish a candidate only after successful CI on a
   push to `main`. Pull requests may build and verify the image but must not
   write to GHCR.
6. **Package visibility:** The GHCR candidate package is public to minimize
   registry cost and avoid candidate-read credentials. Public visibility is not
   the trust decision: downstream admission must validate the allowlisted
   source repository, exact digest, source revision, and approved build
   evidence before copying or deploying the artifact.
7. **Provenance ownership:** The service publication workflow generates a
   GitHub build-provenance attestation for the exact published image digest.
   `movie-platform-environments` owns the admission policy and verification of
   that attestation; it must not generate provenance for an artifact it did not
   build.
8. **Initial hosted-CI gate:** Preserve the monorepo's hosted service checks:
   formatting, linting, TypeScript typecheck, unit tests, integration tests, and
   production build. Do not add Testcontainers/Postgres e2e to the initial
   hosted pipeline.
9. **Deferred e2e gate:** Document Postgres e2e as required follow-up work. Add
   it later as an explicit standalone workflow job or step so its Docker
   dependency, runtime, and failures remain visible rather than hiding it in an
   umbrella script.
10. **Package-script contract:** Keep `npm run ci` as a full local convenience
    wrapper over the smaller validation commands. Hosted GitHub Actions must
    invoke the relevant smaller commands explicitly rather than using the
    wrapper. The quality job calls `format:check`, `lint`, and `typecheck`;
    dedicated jobs call `test:unit`, `test:integration`, and `build`. The future
    hosted e2e command remains independently visible.
11. **Hosted job structure:** Preserve the baseline's separately visible
    `service-quality`, `service-unit-tests`, `service-integration-tests`, and
    `service-build` jobs. The future Testcontainers/Postgres e2e gate becomes a
    fifth standalone job.
12. **Container extraction boundary:** Preserve the behavior of the
    `b9f33ad` service image while adapting only workspace/root paths. Remove the
    unapproved production-only compilation, automatic clean, non-root runtime,
    schema-output change, compiled-migration commands, and behavioral smoke
    implementation from Issue #1. Track them together as an explicit
    container-hardening follow-up.
13. **Pull-request image gate:** After the existing quality, unit, integration,
    and build jobs pass, pull requests build the baseline-compatible Docker
    image with read-only permissions. They do not publish it or run the deferred
    image-runtime smoke.
14. **Hosted e2e delivery:** Implement Testcontainers/Postgres e2e in a
    dedicated follow-up PR after Issue #1 merges. The follow-up adds a separately
    visible hosted job and documents its Docker/runtime contract; Issue #1 does
    not add a main-only or post-publication e2e stage.
15. **Candidate tag:** Publish one human-facing, attempt-unique tag in the form
    `sha-<full-commit-sha>-run-<workflow-run-id>-attempt-<run-attempt>`. Do not
    publish a mutable source-only tag, `latest`, or semantic-version tags. Tags
    provide discovery and retry traceability; the OCI digest remains the
    candidate identity.
16. **Candidate handoff:** Do not create a custom candidate metadata artifact.
    Use the standard OCI digest and source/revision labels, the GitHub build
    attestation, and a workflow summary containing the candidate repository,
    full source SHA, digest-pinned reference, Actions run URL, and verification
    guidance. This satisfies the current `movie-platform-environments` schema,
    which requires only registry/repository/digest and
    sourceRepository/sourceRevision/buildRef.
17. **Publication tooling:** Use focused Docker-maintained login/build actions
    and GitHub's attestation action. Consume the build action's digest output;
    do not maintain a custom image-metadata parser. This requires no Docker Hub
    account, paid Docker service, PAT, Artifactory, or separately managed
    signing key.
18. **Workflow action pinning:** Pin every GitHub Actions dependency to its full
    immutable commit SHA, including read-only validation jobs. Keep the
    corresponding release version in a nearby comment so updates remain easy
    to review. This applies especially to the package-writing and attestation
    job and has no paid-account implication.
19. **Extraction regression test:** Keep a focused Vitest repository-contract
    test for critical standalone invariants that ordinary TypeScript tests do
    not exercise: root package/lockfile consistency, absence of executable
    monorepo workspace paths, and separation of read-only image validation from
    `main`-only publication. Assert durable semantic markers rather than exact
    YAML formatting or broad textual snapshots.
20. **Manual runs and break glass:** Preserve `workflow_dispatch` as a
    read-only troubleshooting path that runs validation and builds the image
    without publishing it. Do not add a manual or privileged break-glass
    publisher. New deployable candidates must come from commits accepted into
    `main`; use a fix or revert PR when a new candidate is needed. Rollback to
    an already-published digest remains an environment-repository concern.
21. **Publication retry:** Allow the original workflow for a legitimate
    `main` push to be rerun after a transient build, registry, or attestation
    failure. This is a retry of the accepted `main` event, not a manual
    publication override. Give every attempt its own tag containing the full
    source SHA, workflow run ID, and run-attempt number so a retry never moves a
    previously published tag. Continue to use the attested digest as identity.
22. **Local developer stack:** Extract the complete reservation-service local
    stack from `b9f33ad`: PostgreSQL, the API, the OpenTelemetry Collector, and
    its configuration, adapting only monorepo paths and container names. Treat
    developer experience as a supported service contract with progressively
    broader feedback levels: isolated unit tests, integration tests, disposable
    or external-Postgres e2e paths, host-run development, and an almost-complete
    Compose environment suitable for local running, debugging, and telemetry
    checks. Broader k3d composition is reviewed separately because it was only
    roadmap work, not implemented in the source baseline.
23. **k3d scope:** Do not add k3d to Issue #1. Create a dedicated follow-up
    initiative for an almost-complete local platform environment, including
    Kubernetes manifest ownership, local image loading, migrations, fake
    dependency contracts, observability, debugging, and cross-repository
    composition. Resolve whether that composition belongs in an environment or
    dedicated local-platform repository during that follow-up's design review.
24. **AI guidance model:** Match the original project. Commit `.ai/` as the
    canonical source, keep `.ai/sync.sh`, and track the generated root
    `AGENTS.md`. Generate `.claude/`, `.codex/`, `.cursor/`, `.gemini/`, and
    `.roo/` locally and gitignore those directories; do not include their
    generated files in pull requests. Review canonical sources and the sync
    mechanism rather than duplicated projections.
25. **Observability test rewrite:** Restore
    `test/integration/observability/telemetry-unavailable.test.ts` to the
    `b9f33ad` behavior for Issue #1. Track dynamic application-port discovery,
    owned rejecting-OTLP-server behavior, cold-start timing, and cleanup as a
    focused test-reliability follow-up. If unchanged hosted CI proves the
    baseline test unreliable, address it in a small test-only PR rather than
    folding the rewrite into extraction work.
26. **Standalone documentation:** Make `README.md` and `DEVELOPMENT.md`
    self-contained for service-owned workflows. Adapt workspace commands,
    paths, and links; document the approved unit, integration, e2e, host-debug,
    Compose, observability, baseline image-build, and candidate-publication
    paths. Remove statements that depend on deferred container hardening or
    superseded CI/tag decisions. Extract only focused service runbooks when an
    inline explanation would become unwieldy; do not copy broad frontend, AWS,
    promotion, or monorepo documentation into this repository.
27. **Docker build context:** Adapt the `b9f33ad` allowlist-style
    `Dockerfile.dockerignore` to standalone root paths. Admit only the package
    manifests, Dockerfile/configuration required by the build, and `src/`;
    exclude tests, scripts, docs, environment files, Compose/observability
    assets, AI guidance, Git data, and local output by default. Keep the general
    `tsconfig.json`; do not add `tsconfig.build.json` merely to compensate for a
    broader-than-baseline build context.
28. **Migration command limitation:** Preserve the baseline source-mode
    `db:migrate` and `db:migrate:status` scripts in Issue #1 even though they
    cannot execute inside the production-only runtime image, which contains
    compiled `dist/` and omits both `src/` and the development-only `tsx`
    runner. Create a focused immutable-image migration-contract follow-up and
    make it a release blocker before any PostgreSQL/RDS-backed environment uses
    the candidate. It does not block the current `local-fixed-user` in-memory
    ECS smoke path.
29. **Initial image platform:** Build and publish explicitly for
    `linux/amd64`, matching the current x64 GitHub-hosted runner and ECS smoke
    path. Do not publish a multi-architecture index in Issue #1. Create a
    coordinated ARM64/Graviton follow-up that covers an ARM-native or proven
    cross-build path, ARM test/smoke execution, base-image support, ECS
    `runtimePlatform`, and rollback compatibility before changing the candidate
    contract. The GitHub runner OS and the Debian Bookworm runtime base are
    separate choices and need not migrate together.
30. **Node base-image pinning:** Preserve the baseline
    `node:24-bookworm-slim` tag in Issue #1. The attempt-unique candidate tag,
    exact output digest, and provenance attestation distinguish rebuilds if the
    upstream base changes. Add immutable base-image digest pinning and a
    documented update/verification process to the supply-chain hardening
    follow-up rather than introducing it during extraction.
31. **GHCR retention:** Do not delete candidate tags, manifests, attestations,
    or untagged digests from this repository in Issue #1. Add retention and
    garbage collection later, with cross-repository visibility into environment
    references, rollback windows, provenance records, and legal/audit needs so
    a service-local age or count rule cannot remove a still-deployable digest.
32. **Compose dependency pinning:** Preserve the baseline
    `postgres:17-alpine` and `otel/opentelemetry-collector:latest` references in
    Issue #1 for the simplest extraction. Create a required local-dependency
    reproducibility follow-up that pins reviewed versions/digests and defines a
    routine update and compatibility-verification process, with the mutable
    collector tag treated as the highest-priority risk.
33. **CI concurrency on `main`:** Publish the newest `main` state rather than
    requiring every intermediate merge to finish publishing. Allow a newer
    `main` run to cancel a superseded in-progress run; under normal Git history,
    the newest commit contains the previously merged changes. Retain the last
    successfully published digest if the newest run fails, and allow the
    legitimate newest run to be retried. Revisit expanded queuing or a merge
    queue when repository activity or contributor count grows; neither is
    justified while this is a single-maintainer repository.
34. **`main` admission:** Require changes to enter `main` through a pull
    request with the configured CI checks passing; block routine direct pushes.
    Do not require another maintainer's approval while this is a
    single-maintainer repository. Treat the GitHub branch/ruleset configuration
    as an explicitly authorized operational step, not an implicit code change.
35. **Future branch previews:** Track a cross-repository preview-environment
    initiative for deploying feature branches or draft PRs to an isolated
    alpha/pre-development wave for realistic e2e exploration. Preview artifacts
    must be visibly non-promotable, separately named and attested, isolated from
    normal environment intent, and automatically cleaned up. The service would
    build the preview candidate; environment/platform automation would own
    selection, deployment, fake/shared dependency policy, access, and teardown.
    This is not part of Issue #1 and does not weaken the current rule that
    normal deployable candidates originate from `main`.
36. **Draft pull requests:** Run the complete current read-only validation set
    for draft PRs: quality, unit tests, integration tests, production build, and
    baseline-compatible container build. Draft PRs receive no package-write or
    attestation permissions and never publish. This supplies early feedback now
    and establishes the validation boundary for the future preview initiative.
37. **Local container command:** Add only `npm run docker:build` as a small,
    dependency-free convenience wrapper for the baseline-compatible image build
    used by CI. Do not add the current custom `docker:smoke` implementation or a
    family of Compose/run wrappers in Issue #1; behavioral image smoke remains
    part of the container-hardening follow-up.
38. **Workflow boundary:** Keep validation, read-only image building, and
    `main`-only publication in one GitHub Actions workflow, using separate,
    visibly named jobs and job-scoped permissions. The publication job depends
    directly on the required validation jobs so the exact accepted source event
    and gate result remain easy to audit. Do not introduce cross-workflow result
    transfer or reusable-workflow indirection in Issue #1.
39. **Future CI building blocks:** Track an organization-level initiative for
    reusable CI components across the existing sibling repositories. Start by
    inventorying their languages, build systems, artifact types, test/runtime
    dependencies, and publication contracts. Prefer small composable building
    blocks and policy conventions over one universal workflow; keep
    repository-owned orchestration visible so each service can add its own
    quality and integration gates. Decide the owning repository and versioning,
    action pinning, rollout, compatibility, and emergency-update model before
    centralizing production pipelines.
40. **First GHCR package bootstrap:** Let the first successful `main`
    publication create and link the GHCR package using the repository's
    `GITHUB_TOKEN`. The owner then performs a one-time package-settings change
    from GitHub's default private visibility to public and verifies an anonymous
    pull using the exact published digest. Do not add a PAT, broader credential,
    or visibility-changing API automation for this bootstrap.
41. **Public-access verification:** Keep anonymous digest-pull verification as
    a manual first-release checklist item in Issue #1. Do not fail every service
    publication on a second unauthenticated pull. Add ongoing accessibility,
    source, revision, digest, and attestation verification with the future
    environment admission automation, which has the release-state context to
    make that trust decision.
42. **AI guidance formatting:** Include canonical `.ai/` sources and the
    tracked generated root `AGENTS.md` in normal repository formatting checks.
    Exclude only the gitignored, tool-specific `.claude/`, `.codex/`,
    `.cursor/`, `.gemini/`, and `.roo/` projections from the product formatter.
    `.ai/` remains the sole canonical guidance directory; root `AGENTS.md` is
    the original project's tracked generated entry point, not a second source.
43. **Package metadata diagnostic:** Update `src/service-metadata.ts` to refer
    to root `package.json` instead of the former
    `movie-reservation-service/package.json` workspace path. Preserve service
    name/version validation and exported identity behavior unchanged.
44. **GitHub runner label:** Preserve the baseline `ubuntu-latest` runner label
    in Issue #1. Continue to set the image build target explicitly to
    `linux/amd64` so a runner-image change cannot silently alter the candidate
    platform. Revisit a fixed runner image and ARM-native runners as part of the
    coordinated CI-platform/ARM64/Graviton follow-up.
45. **Hosted command split:** Preserve the baseline's focused command boundary:
    `service-quality` runs `format:check`, `lint`, and `typecheck` explicitly;
    the unit, integration, and build jobs run `test:unit`, `test:integration`,
    and `build` respectively. Do not call `npm run check` or `npm run ci` from
    hosted Actions. Those remain local convenience wrappers, and the future e2e
    job invokes its dedicated command directly.
46. **CI job topology:** Preserve the baseline dependency graph:
    `service-quality` completes first; `service-unit-tests`,
    `service-integration-tests`, and `service-build` then run independently;
    the event-specific image job waits for all three downstream jobs. Add the
    future Testcontainers/Postgres e2e execution as its own visible job and
    decide its exact dependency/resource policy in that follow-up, without
    hiding it inside an existing job or wrapper.
47. **CI dependency installation:** Give each isolated hosted job its own
    lockfile-backed `npm ci`, using `setup-node`'s npm download cache. Do not
    upload or share `node_modules` between runners and do not collapse the
    approved job boundaries. Measure install and total pipeline timings after
    release, then address YAML/install/runtime optimization through the future
    reusable-CI-building-block initiative.
48. **Hosted job timeouts:** Keep quality, unit, integration, and TypeScript
    build jobs at 15 minutes. Give read-only and publishing container-image jobs
    30 minutes for cold Buildx/base-image behavior. Set the future
    Testcontainers/Postgres e2e timeout independently from measured cold-start
    and database-container timings.
49. **Partial publication failure:** If the image push succeeds but attestation
    generation, registry attachment, or final reporting fails, fail the
    workflow and treat that digest as ineligible for admission. Leave the
    content in GHCR; grant no package-delete authority and perform no cleanup in
    service CI. Retry the original legitimate `main` workflow, producing a new
    attempt-unique tag and requiring a complete successful attestation path.
50. **Required pull-request checks:** Configure stable required-check names for
    `service-quality`, `service-unit-tests`, `service-integration-tests`,
    `service-build`, and the read-only container-image build. All five must pass
    before merge to `main`. Add the future Testcontainers/Postgres e2e job to
    the ruleset only when its dedicated follow-up is implemented and stable.
51. **Fork publication boundary:** Allow the public repository to be forked,
    but never publish an upstream candidate from fork activity. Trigger
    upstream publication only for a `push` to `main` when
    `github.repository` exactly matches
    `movie-reservation-platform-lab/movie-reservation-service`. Keep
    `pull_request` jobs read-only, use no `pull_request_target`, and expose no
    publication credentials. A fork owner may independently publish to a
    package namespace they control; that cannot modify the canonical GHCR
    package. Revisit external-contributor workflow-approval policy later.
52. **PR count and capability slices:** Deliver Issue #1 as five ordered,
    independently reviewable PRs: (1) canonical AI guidance and generated-file
    policy; (2) standalone developer-experience extraction; (3) baseline
    container contract; (4) focused hosted CI plus read-only image validation;
    and (5) main-only GHCR publication and provenance. Keep candidate
    publication absent until PR 5 so each earlier merge is operationally
    read-only with respect to GHCR.
53. **PR dependency strategy:** Deliver the five PRs sequentially. Create each
    slice from the newly merged and verified `main`, rather than opening a
    stacked chain or preparing one mixed branch to split later. Re-run the
    applicable gates after every merge and stop before starting the next slice
    if the prior merge exposes an extraction or hosted-CI problem.
54. **Issue closure:** Reference every slice as `Part of #1`; do not use an
    auto-closing keyword in PR 1 through PR 5. Keep Issue #1 open after PR 5
    merges until the first canonical publication succeeds, the package link,
    public access, digest, and provenance are verified, and the explicitly
    authorized AWS smoke passes for the admitted digest. Close Issue #1
    manually only after those gates, and retain the golden-path source copy
    until then.
55. **Follow-up tracking:** After this plan receives final approval, create
    separate linked GitHub issues for independently deliverable follow-ups and
    group only tightly coupled work. Keep service-local work in this repository;
    route environment/preview, infrastructure/Graviton, and organization-wide
    CI work to their owning repositories or an explicit cross-repository
    tracker. Link the resulting issues from Issue #1 and this plan rather than
    relying on prose-only reminders.
56. **Per-slice approval checkpoint:** Implement only one approved PR slice at
    a time. Run its local checks and present the exact scoped diff and findings
    to the owner. Do not commit, push, create a remote branch, open a PR, or
    merge until the owner explicitly approves that next external action. Never
    auto-merge. After the owner merges and the resulting `main` run is verified,
    begin the next slice from updated `main`.
57. **Merge strategy:** Squash-merge each approved slice into one
    capability-focused commit, preserving the repository's current linear,
    approximately one-commit-per-PR history. Use `Part of #1` in the PR body and
    reference Issue #1 in the squash message without an auto-closing keyword.
58. **Follow-up issue grouping:** After checking existing backlogs for
    duplicates, create nine linked follow-ups: hosted Testcontainers e2e;
    immutable-image migrations; container hardening/runtime smoke; base and
    Compose image pinning; ARM64/Graviton migration; environment admission and
    safe GHCR retention; k3d local platform; draft-PR preview environments; and
    organization-wide reusable CI/optimization. Keep the observability-test
    rewrite and merge queue as trigger-based notes until demonstrated CI
    flakiness or repository activity justifies an issue.
59. **First admission and ownership:** For Issue #1's first AWS smoke, use an
    explicitly authorized manual admission procedure owned and documented by
    the sibling `movie-platform-environments` repository. It verifies the
    canonical source, full revision, GHCR digest, and GitHub attestation; copies
    the exact bytes to private ECR; and verifies the destination digest before
    `movie-platform-infra` consumes it. Future admission validation, copying,
    release selection, and promotion automation remain concerns of
    `movie-platform-environments`. This service repository stops at publishing
    the attested public GHCR candidate and must not implement that procedure.
60. **Mixed-worktree preservation:** Preserve the current
    `issue-1-stabilize-standalone-extraction` worktree unchanged as reference
    evidence for approved and rejected experiments. Implement each sequential
    slice in a fresh local Git worktree created from the newly verified `main`,
    copying or recreating only files belonging to that slice. Do not use an
    opaque full-worktree stash or clean/revert the reference worktree in place.
    Creating a local implementation worktree does not authorize a commit,
    remote branch, push, PR, or merge; those remain subject to decision 56.
61. **Plan publication:** Include this finalized plan in PR 1 as the durable
    owner-decision, scope, sequencing, and follow-up record. Later slices link
    to it and modify it only when concrete implementation evidence requires an
    owner-approved correction. Do not add a sixth plan-only PR and do not leave
    the plan solely in the local reference worktree.
62. **Stale publication retry:** Before pushing, verify that the workflow's
    source SHA still equals the canonical repository's current `main` SHA. A
    rerun may publish only while that equality holds. If `main` has advanced,
    the historical run exits without publishing and the newer cumulative state
    owns candidate creation. Restoring older behavior requires a revert PR that
    produces a new current commit. This check is best-effort because `main` can
    advance between verification and publication; attempt-unique tags and
    digest-based admission prevent an older run from overwriting another
    candidate. Revisit merge queues only when repository activity creates a
    demonstrated need.

### Confirmed Requirements

- Review and re-plan issue #1 on the current branch without implementing,
  committing, or pushing until the owner approves the plan.
- Use the original golden-path monorepo reservation service as the primary
  migration and compatibility source, pinned to revision `b9f33ad`.
- Keep issue #1 focused on transferring required material into this standalone
  repository and adapting only monorepo-specific assumptions.
- Preserve documented developer workflows at multiple feedback levels, from
  fast unit/integration checks through database-backed e2e and the extracted
  service-local Compose/observability environment.
- Treat standalone-only redesigns, hardening, refactors, and new repository
  infrastructure as out of scope unless the owner approves them explicitly.
- Use the standalone NestJS/TypeScript architecture and preserve service
  behavior.
- Use root npm commands and the committed root lockfile.
- Keep application CI credential-free with respect to AWS.
- Publish candidate images to GHCR without AWS credentials or knowledge of the
  downstream promotion/deployment mechanism.
- Publish no secrets, credentials, rendered environment values, private data,
  or unintended source/development material in the public image.
- Generate verifiable build provenance for the exact GHCR digest without a
  long-lived signing key; downstream admission decides whether that evidence is
  sufficient.
- Produce an owner-approved plan before implementation or release work begins.

### Assumptions

- A successful push to `main` is the only event authorized to publish a GHCR
  candidate. Pull requests and manual dispatches build but do not publish.
- The attempt-unique source/run tag is for discovery and traceability, not the
  deployment identity. The reported digest is immutable and is the only value
  that should enter an environment release. No mutable source-only, `latest`,
  or semantic-version tag is published.
- The repository name is lowercase in the organization, while the workflow
  will still normalize the dynamic GHCR repository path for fork safety.
- GitHub-hosted `ubuntu-latest` provides Docker for Testcontainers and image
  builds. Issue #1 explicitly targets Linux/amd64; ARM64/Graviton is a
  coordinated service/infrastructure follow-up rather than a multi-architecture
  addition to this extraction.
- Canonical `.ai/` guidance and generated root `AGENTS.md` are repository
  infrastructure. Tool-specific projections are local generated output owned
  by `.ai/sync.sh`, ignored by Git, and excluded from product formatting.
- Local CI-equivalent checks and a baseline-compatible local image build are
  sufficient before PR review. A real Actions run, one-time package visibility
  and anonymous-pull check, and authorized AWS smoke deployment happen only at
  the approved release stages.

### Open Questions

- When will the authorized AWS smoke deployment run? Until it passes, issue #1's
  final operational gate remains open and the golden-path copy remains retained.

The first admission is an explicitly authorized manual procedure in
`movie-platform-environments`; admission automation is a follow-up in that
repository.

These operational questions do not expand this service repository's ownership
and do not block reviewing the PR/release split.

## 6. Proposed Design

> **Review note:** The technical design below reflects the recorded owner
> decisions. Its delivery grouping is provisional until the PR/release split is
> approved.

### Standalone repository contract

Add a fast Vitest repository-contract test that reads the root package,
lockfile, Dockerfile, documentation, and CI workflow. It should protect behavior
that is easy to regress during extraction:

- root package and lockfile names match;
- no npm workspace field or workspace-scoped command remains;
- no parent `node_modules`, nested service build context, or monorepo working
  directory remains in executable/docs surfaces;
- CI calls the public root scripts and contains both a non-publishing image
  verification path and a `main`-only publication path;
- the publication contract emits a digest-pinned reference.

This is a repository contract rather than a NestJS test, so it should use
Node filesystem APIs directly and start no Nest application. The checks should
assert durable semantic markers and avoid matching full YAML formatting.

### Baseline-compatible image extraction

Preserve the `b9f33ad` image behavior while adapting its monorepo workspace
paths to this repository root. Adapt its Docker build-context allowlist so only
the required manifests/configuration and `src/` are copied. Keep the existing
`tsconfig.json` build, source-mode generic migration commands, GraphQL
schema-output behavior, runtime user, multi-stage production dependency
installation, and runtime contents.

Do not introduce `tsconfig.build.json`, automatic `dist/` cleanup, non-root
execution, compiled migration commands, temporary-directory schema output, or
the hardening-oriented container smoke in Issue #1. Those changes interact and
must be designed and reviewed together in the follow-up below.

### Deferred follow-up: container image hardening

Create a separate follow-up plan/issue that evaluates and verifies:

- continued allowlist enforcement and explicit runtime image-content checks;
- non-root runtime execution;
- a deliberate GraphQL schema generation/publishing boundary;
- compiled migration execution from the immutable image;
- image content/secrets inspection and a behavioral `/health` smoke;
- compatibility with the downstream ECS runtime and rollback contract.

### CI privilege and artifact flow

Use separate service-validation jobs followed by event-specific image jobs:

```text
service-quality
  ├─ service-unit-tests
  ├─ service-integration-tests
  └─ service-build

all required service jobs pass
  ├─ PR/manual event                      -> container-image-check (contents: read)
  └─ canonical repository main push only -> publish-candidate
```

The hosted workflow preserves separately visible jobs for quality, unit tests,
integration tests, and build. It invokes their focused package scripts rather
than `npm run ci`. The `ci` script remains a full local convenience wrapper.

Testcontainers/Postgres e2e is delivered in a separate PR after Issue #1. When
added, it must be a separate workflow job with its Docker dependency and failure
surface visible; it must not be hidden inside the general repository check.

The non-main image job builds the baseline-compatible image with only read
permission. It does not publish and does not run the deferred hardening-oriented
container smoke.
The `main` publication job alone receives publication/attestation permissions,
logs in to GHCR with `GITHUB_TOKEN`, uses the focused Docker build action to
push the attempt-unique source/run-tagged image, passes its digest output to
GitHub's attestation action, and writes the approved handoff fields to the job
summary.
This avoids custom digest parsing and grants no package write capability to
pull-request image builds.

### Documentation and operational boundary

README and development documentation should distinguish:

- an attempt-unique source-SHA/run tag for discovery and retry traceability;
- the immutable digest for candidate admission/promotion;
- hosted CI success and GHCR visibility as post-push checks;
- AWS smoke deployment as a separately authorized gate;
- golden-path retention until those gates pass.

## 7. Alternatives Considered

### Alternative A: One conditional image job for build and publish

- Pros: Fewer workflow lines and one job name.
- Cons: The job needs `packages: write` even when a pull request only builds an
  image; the privilege boundary is harder to review and enforce.
- Decision: Rejected. Separate jobs make the trust boundary explicit without
  adding dependencies.

### Alternative B: Focused Docker/GitHub actions for image publication

- Pros: Standard GitHub examples, structured action outputs, built-in metadata
  helpers, and easy future attestation integration.
- Cons: Adds multiple third-party action dependencies that must be SHA-pinned
  and maintained.
- Decision: Selected. Use focused login/build and attestation actions, consume
  the build digest output directly, remove the custom metadata parser, and pin
  every workflow action to a full immutable commit SHA with a readable release
  version comment.

### Alternative C: Trust manual scanning instead of a repository-contract test

- Pros: No test code and no coupling to repository files.
- Cons: Workspace paths and privileged workflow regressions are precisely the
  kind of extraction errors that compile-time and domain tests do not detect.
- Decision: Rejected. Add a small semantic test with no new dependency.

### Alternative D: Keep one TypeScript config with the baseline build allowlist

- Pros: No configuration split; the original Docker context already restricts
  container compilation to `src/`.
- Cons: Local non-container builds still compile every path selected by the
  general configuration and may retain stale output without an explicit clean.
- Decision: Selected for Issue #1 to preserve the extracted image behavior.
  The container-hardening follow-up should verify image contents instead of
  assuming a second TypeScript configuration is necessary.

## 8. API / Interface Changes

- GraphQL and HTTP APIs: none.
- Application/domain ports: none.
- npm scripts:
  - preserve the baseline `build`, `db:migrate`, and `db:migrate:status`
    behavior;
  - keep focused quality/test/build scripts and retain `ci` only as the full
    local convenience wrapper;
  - add only `npm run docker:build` as the local container convenience command;
    defer behavioral image smoke automation.
- GitHub Actions:
  - pull requests/manual runs build without publishing;
  - `main` pushes publish
    `ghcr.io/<owner>/<repository>:sha-<commit>-run-<run-id>-attempt-<attempt>`;
  - the job summary reports `<image>@sha256:<digest>`, the full source SHA,
    Actions run URL, and attestation verification guidance;
  - no custom candidate metadata artifact is uploaded.

## 9. Data Model / Persistence Changes

None. No migration, seed, transaction, claim, idempotency, or stored reservation
state changes are in scope.

## 10. Security, Privacy, and Abuse Considerations

- Keep global workflow permissions at `contents: read`; grant `packages: write`,
  `id-token: write`, and `attestations: write` only to the `main`-only
  publication job.
- Pin every workflow action to an immutable commit SHA, especially in the
  package-writing publication job, and disable persisted checkout credentials
  there.
- Use GitHub's ephemeral `GITHUB_TOKEN`; do not add PATs, AWS credentials, or
  repository secrets.
- Pass the ephemeral token only to the focused GHCR login action; do not print
  it or persist checkout credentials.
- Do not publish from `pull_request`, `workflow_dispatch`, or fork events;
  require the exact canonical repository plus a push to `main`.
- Preserve the baseline runtime image behavior and ensure no rendered local env
  files, generated AI config, Git metadata, secrets, or development
  dependencies enter the public runtime image. Production-only output and
  non-root execution are deferred hardening decisions.
- OCI source/revision/version labels provide traceability but are not a
  signature. Generate a GitHub artifact attestation over the published digest;
  the environment admission workflow remains responsible for verification and
  policy enforcement.
- The committed Compose credentials and env templates are development-only;
  rendered env files and real secrets remain ignored.
- Package visibility is external state. Verify it after first publication; do
  not automate a visibility change with broader credentials in this PR. The
  intended visibility is public, and the package must be linked to this source
  repository.

## 11. Performance, Scalability, and Reliability Considerations

- Splitting build and publish by event avoids building the same image twice in a
  single workflow run.
- Runtime image size/content remains at the extracted baseline because the
  root-adapted Docker allowlist excludes tests, scripts, and repository tooling.
- `npm ci` and the committed lockfile preserve dependency graph repeatability.
- A retry receives a new attempt-unique tag, so it cannot repoint a prior tag
  if upstream base tags produce different bytes. Consumers must still use the
  reported digest, never the tag, as the deployment identity.
- Publication depends on the approved hosted quality, unit, integration, and
  build jobs. Postgres Testcontainers coverage is a documented future separate
  gate. A Docker daemon/registry outage fails explicitly; there is no silent
  skip or automatic deployment.
- Concurrency cancellation prevents superseded PR/manual and `main` runs from
  consuming CI resources. The newest `main` state is the publication target,
  while every previously completed digest remains immutable in GHCR. Merge
  queues or serialized publication remain scaling follow-ups.
- Runtime scaling, database pooling, reservation concurrency, and retry behavior
  are unchanged.

## 12. Approved PR Slices

Each PR must be independently understandable, pass the checks available at that
stage, and avoid bundling follow-up hardening.

1. **PR 1 — Canonical AI guidance and generated-file policy**
   - Change: commit the service-specific `.ai/` source and sync mechanism,
     retain generated root `AGENTS.md`, restore the baseline Git ignore policy
     for tool projections, and format canonical/tracked guidance while excluding
     only generated tool directories.
   - Files/modules: `.ai/**`, `.ai/sync.sh`, `.gitignore`, `.prettierignore`,
     `AGENTS.md`, and this finalized plan. Do not commit `.claude/`, `.codex/`,
     `.cursor/`, `.gemini/`, or `.roo/`.
   - Verification: run `.ai/sync.sh`, inspect canonical/generated diffs, run
     `npm run format:check`, confirm tool projections are untracked, and run
     `git diff --check`.

2. **PR 2 — Standalone developer-experience extraction**
   - Change: extract the service-local PostgreSQL/API/OTel Compose stack and
     collector configuration, correct the package-metadata root diagnostic,
     adapt service-owned local-development documentation, add the focused
     standalone regression test, and restore the unrelated observability test
     rewrite to baseline behavior.
   - Files/modules: `docker-compose.yml`, `observability/**`, `README.md`,
     `DEVELOPMENT.md`, `src/service-metadata.ts`,
     `test/unit/repository/standalone-extraction.test.ts`, and
     `test/integration/observability/telemetry-unavailable.test.ts`.
   - Verification: focused repository test, unit/integration tests,
     `docker compose config --quiet`, documented host/Compose path review, and
     `git diff --check`.

3. **PR 3 — Baseline-compatible container contract**
   - Change: retain only root-path adaptations in the Dockerfile, restore the
     baseline allowlist-style build context, add only `npm run docker:build`,
     restore baseline schema/migration/runtime-user behavior, and remove the
     unapproved hardening implementation and helpers.
   - Files/modules: `Dockerfile`, `Dockerfile.dockerignore`, `package.json`,
     `src/generated-graphql-schema.ts`, relevant container documentation;
     remove `tsconfig.build.json`, `scripts/container-smoke.mjs`, and
     `scripts/read-container-image-digest.mjs` from the proposed change.
   - Verification: `npm run typecheck`, `npm run build`, `npm run docker:build`,
     Dockerfile/build-context comparison with `b9f33ad`, and `npm run ci`.

4. **PR 4 — Focused hosted CI and read-only image validation**
   - Change: restore the four baseline service jobs and focused commands, pin
     every action, preserve read-only draft/PR/manual validation, run the
     baseline-compatible image build with no publication, use approved timeout
     and concurrency policies, and expand the repository-contract test for the
     CI boundary.
   - Files/modules: `.github/workflows/ci.yml`, CI sections of `README.md` and
     `DEVELOPMENT.md`, repository-contract test.
   - Verification: local focused commands and wrappers, semantic workflow test,
     workflow permission/condition review, and successful hosted PR checks.
     Once the stable job names have run, configure all five as required checks.

5. **PR 5 — Main-only GHCR candidate publication and provenance**
   - Change: add the canonical-repository/main-only publisher, focused GHCR
     login/build/attestation actions, explicit Linux/amd64 target,
     attempt-unique tag, OCI source/revision labels, digest-pinned summary, and
     partial-failure behavior. Keep PR/manual/fork events read-only.
   - Files/modules: `.github/workflows/ci.yml`, publication sections of
     `README.md` and `DEVELOPMENT.md`, repository-contract test.
   - Verification before merge: all five required PR checks and workflow
     security review. After merge: inspect the first `main` run, package link,
     digest, and attestation; make the package public once and verify an
     anonymous pull by digest.

Run read-only security, maintainability, and system-design reviews on each
slice in proportion to its risk, with a final cross-slice review before PR 5 is
merged. Do not fold findings from the deferred follow-ups into these PRs.

## 13. Testing Strategy

- Unit/repository contract:
  - root `package.json` and lockfile identify the standalone service;
  - no workspaces or parent/nested workspace command paths remain;
  - Dockerfile contains only required standalone path adaptations and has no
    monorepo workdir;
  - CI contains the approved service jobs, non-publishing image build, and a
    `main`-only digest-reporting publication job.
- Existing unit tests: run all domain/application/config/observability tests.
- Existing integration tests: run GraphQL, health, DI, in-memory repository,
  schema, processor, and the unchanged baseline telemetry-unavailable suite.
  Dynamic port ownership and cold-start reliability changes belong to the
  focused test follow-up unless hosted CI demonstrates a blocking failure.
- Existing e2e tests: keep disposable-Postgres Testcontainers coverage available
  through `npm run test:e2e` for local/manual verification. Document a follow-up
  to add it as a separate hosted workflow job or step.
- Build/artifact checks: compile with the baseline TypeScript configuration,
  compare Docker behavior with the source baseline, and run the approved local
  image build without the deferred behavioral smoke.
- Contract/regression: scan executable/docs surfaces for `npm -w`,
  `--workspace`, parent `node_modules`, and nested service build paths.
- Hosted follow-up: after the user pushes, verify the PR run, `main` run, GHCR
  source link, attempt-unique tag, reported digest, and attestation. During the
  first-release bootstrap, change the linked package to public and manually
  verify one anonymous digest pull.
- AWS smoke follow-up: after explicit authorization and private admission, run
  the existing platform smoke checklist against the same admitted digest.
- Performance/load: not applicable; no runtime request path changes.
- Security: verify job-level permissions and that publication cannot run on pull
  request/manual events.

## 14. Rollout / Migration Plan

1. Create each slice from the newly merged and verified `main`. Land PR 1 (AI
   guidance policy), then PR 2 (developer-experience extraction), then PR 3
   (container parity). None can publish to GHCR.
2. Land PR 4 with focused code jobs and read-only image building. Observe its
   stable check names, then configure the `main` ruleset to require a PR and all
   five read-only checks without requiring a second reviewer.
3. Open PR 5 only after those checks protect `main`. Its PR run builds but does
   not publish; complete the final cross-slice security/design review before
   merge.
4. Merge PR 5 and observe the first publication workflow. Record its run URL and
   `ghcr.io/...@sha256:...` summary, and verify package repository linkage and
   intended visibility.
5. Hand the published digest and provenance evidence to
   `movie-platform-environments`. With separate explicit authorization, follow
   that repository's current admission procedure, tracked by
   [`movie-platform-environments#17`](https://github.com/movie-reservation-platform-lab/movie-platform-environments/issues/17);
   this service plan does not duplicate its operational runbook.
6. After the environment repository records the admitted ECR digest, follow the
   current `movie-platform-infra` deployment/smoke procedure with explicit AWS
   authorization. Platform evidence ownership is tracked by
   [`movie-platform-infra#10`](https://github.com/movie-reservation-platform-lab/movie-platform-infra/issues/10).
7. Retain the golden-path copy until the hosted CI and smoke gates pass.

Rollback is straightforward before publication: revert the relevant PR slice.
After publication, never delete or mutate an already selected digest; restore
the prior environment manifest selection if compatible, or publish a forward
fix. A failed publication does not change environment desired state.

## 15. Risks and Mitigations

| Risk                                                                    |                    Impact |             Likelihood | Mitigation                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------: | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted workflow syntax differs from local expectations                  |                      High |                    Low | Keep YAML simple, add semantic repository checks, and require a PR Actions run before merge.                                          |
| Pull-request code receives package write authority                      |                      High |  Medium without change | Put `packages: write` only on the `main`-only publication job.                                                                        |
| Mutable third-party action runs with package write authority            |                      High |  Medium without change | Pin every action to a full immutable commit SHA and disable checkout credential persistence.                                          |
| PR build passes while main-only registry/attestation steps are broken   |                      High |  Medium without change | Exercise the same Buildx inputs read-only on PRs; treat first publication and attestation as an explicit gate.                        |
| A traceability tag is mistaken for immutable identity                   |                      High |                 Medium | Keep tags attempt-unique, report the digest-pinned reference, and require environments to select it.                                  |
| Standalone Docker context drifts broader than the source image          |                    Medium |                   High | Adapt the baseline allowlist to root paths and guard critical exclusions with the repository-contract test.                           |
| AI projections create PR noise or receive divergent edits               |                    Medium |  High in current state | Track `.ai/` plus root `AGENTS.md`; gitignore tool directories and regenerate them with `.ai/sync.sh`.                                |
| First GHCR package is private or not linked as expected                 | High for public admission |                 Medium | Perform the one-time linkage/public-visibility/anonymous-pull checklist; add no broad credential.                                     |
| Base image or npm dependencies change on a rerun of the same source SHA |                    Medium |                 Medium | Treat each resulting digest as distinct and promote only the reviewed digest; base-image pinning can follow.                          |
| `main` advances between the stale-run check and image publication       |                    Medium | Low for one maintainer | Keep the check best-effort, never reuse tags, admit only an explicitly reviewed digest, and revisit merge queues when activity grows. |
| Deferred hosted Postgres e2e leaves a coverage gap                      |                    Medium |                 Medium | Keep local e2e in the full wrapper and document a separate hosted e2e follow-up with an explicit job.                                 |
| Scope expands into promotion/AWS deployment                             |                      High |                 Medium | Preserve repository boundaries and require separate authorization/workflows.                                                          |

## 16. Done Criteria

- `npm run check` passes from the standalone repository root.
- `npm run ci` passes, including disposable-Postgres e2e and production build.
- No actionable monorepo command/path assumptions remain.
- The Dockerfile differs from `golden-path-ecs-template@b9f33ad` only where the
  standalone package/build context requires it.
- No rendered environment files, secrets, generated AI configuration, or
  development dependencies enter the public runtime image.
- Pull requests build the baseline-compatible image without publishing it.
- Pull-request/manual image jobs have no package write permission and never
  publish.
- The `main` publication job is gated by repository CI, pushes an
  attempt-unique source/run tag,
  and reports a validated digest-pinned GHCR reference.
- README/development docs explain candidate versus deployment identity and the
  remaining hosted/AWS gates.
- Repository diff and read-only agent reviews have no unresolved high-severity
  in-scope findings.
- The final approved slices contain no generated tool-specific AI directories,
  custom image-metadata parser, hardening smoke helper, or unrelated
  observability-test rewrite.

Hosted Actions execution, GHCR visibility/linkage, and an authorized AWS smoke
deployment are explicitly post-push done criteria for closing issue #1, not
claims made by this local session.

## 17. Review Checklist

- [x] Requirements are explicitly approved
- [x] Non-goals are explicitly approved
- [x] Existing code and original-monorepo conventions were checked
- [x] Alternatives were reviewed with the owner
- [x] Security implications were reviewed
- [x] Scalability and reliability implications were reviewed
- [x] Testing strategy is approved
- [x] Rollout and rollback are approved
- [x] Implementation steps are ordered, concrete, and approved

## 18. Approved Follow-Up Issue Map

The final duplicate check found no matching open or closed issues. The approved
follow-ups were created and cross-linked on 2026-08-12:

1. [`movie-reservation-service#8`](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/8):
   **Add hosted Testcontainers PostgreSQL e2e job**. Add one visible required
   job after its Docker contract and cold-start timeout are proven.
2. [`movie-reservation-service#9`](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/9):
   **Make database migrations runnable from the immutable service image**.
   Treat this as a blocker for PostgreSQL-backed environments and link it to
   [`movie-platform-infra#4`](https://github.com/movie-reservation-platform-lab/movie-platform-infra/issues/4).
3. [`movie-reservation-service#11`](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/11):
   **Harden the production container and add a behavioral image smoke**. Cover
   non-root execution, schema output, clean builds, content inspection, health
   behavior, and ECS compatibility.
4. [`movie-reservation-service#10`](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/10):
   **Pin runtime and local dependency images with an update process**. Cover
   the Node base, PostgreSQL, OTel Collector, and runner-image reproducibility
   without mixing in ARM migration.
5. [Organization `.github#6`](https://github.com/movie-reservation-platform-lab/.github/issues/6):
   **Coordinate ARM64/Graviton candidate and ECS runtime migration**. Track
   service build/test/smoke, base support, explicit ECS architecture, rollback,
   and repository-specific child work.
6. [`movie-platform-environments#17`](https://github.com/movie-reservation-platform-lab/movie-platform-environments/issues/17):
   **Implement candidate admission, exact GHCR-to-ECR copy, and safe
   retention**. Verify public access, source, revision, digest, and attestation;
   copy exact bytes; verify the ECR digest; and delete nothing still selected or
   retained for rollback. Depend on
   [`movie-platform-environments#9`](https://github.com/movie-reservation-platform-lab/movie-platform-environments/issues/9)
   and
   [`#13`](https://github.com/movie-reservation-platform-lab/movie-platform-environments/issues/13).
7. [Organization `.github#7`](https://github.com/movie-reservation-platform-lab/.github/issues/7):
   **Design a k3d near-complete local platform environment**. Resolve repository
   ownership, local images, migrations, fake dependencies, observability,
   debugging, and multi-service composition.
8. [`movie-platform-environments#16`](https://github.com/movie-reservation-platform-lab/movie-platform-environments/issues/16):
   **Add isolated draft-PR preview environments**. Define non-promotable preview
   artifacts, an alpha/pre-dev wave, access/isolation, fake/shared dependencies,
   e2e evidence, and cleanup; relate it to environment issues #11 and #13.
9. [Organization `.github#5`](https://github.com/movie-reservation-platform-lab/.github/issues/5):
   **Provide reusable organization CI building blocks**. Inventory TypeScript,
   React, Python, Rust, infrastructure, and contract repositories; define
   composable versioned components, pinning, rollout, emergency updates, and
   measured installation/runtime optimization.

Do not create issues for merge queues or the observability integration-test
rewrite until contributor/activity growth or hosted flakiness demonstrates the
need.

## 19. Handoff Prompt for Implementation Agent

> **The plan is approved, but do not use this handoff prompt until the owner
> separately authorizes local implementation of PR 1.**

```text
Implement the plan in
docs/plans/stabilize-standalone-reservation-service-extraction.md.

Constraints:
- Stay within the scope of the plan.
- Do not introduce new dependencies.
- Preserve all GraphQL, HTTP, reservation, persistence, auth, and observability
  behavior.
- Preserve canonical `.ai/` worktree changes and root `AGENTS.md`; remove local
  generated tool-directory projections from the planned review surface through
  the original project's ignore model without treating them as product source.
- Do not commit, push, publish, deploy, change package visibility, or mutate AWS
  or environment state.
- Keep packages: write confined to the main-only publication job.
- Pin workflow actions to immutable commit SHAs.
- Treat the attempt-unique source/run tag as traceability and the sha256 digest
  as deployment identity.
- If implementation reality differs materially from the plan, update the plan
  before changing scope.

Relevant files/modules:
- .ai/
- .ai/sync.sh
- .gitignore
- AGENTS.md
- package.json
- package-lock.json
- tsconfig.json
- Dockerfile
- Dockerfile.dockerignore
- docker-compose.yml
- observability/
- .github/workflows/ci.yml
- .prettierignore
- README.md
- DEVELOPMENT.md
- src/service-metadata.ts
- test/unit/repository/standalone-extraction.test.ts

Expected verification commands:
- npm run format:check
- npm run lint
- npm run typecheck
- npm run test:unit
- npm run test:integration
- npm run test:e2e
- npm run build
- npm run check
- npm run ci
- npm run docker:build
- docker compose config --quiet
- git diff --check
```

## References

Used local Programming KB notes:

- `Multi-Service Release Composition`
- `Environment Release Manifest`
- `Prefer Compatibility-First Independent Deployments`
- `Treat AI Context as Repository Infrastructure`

Version-sensitive workflow details were checked against GitHub's official
[Publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
and [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
documentation.
