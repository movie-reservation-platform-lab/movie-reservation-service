# Implementation Plan: Reservation-service shared evidence v1alpha3

## 1. Summary

Tracking: [reservation-service #38](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/38).
Inspected September 15, 2026. Enroll the service in shared actions, add explicit
service v3 reader support and a parallel consumer-owned admission route, then
switch the producer to a reviewed immutable enrollment release. Keep strict v1
verification available throughout the transition and rollback.

The follow-up request authorizes implementation, commits, pushes and review PRs
in the affected repositories. Actions enrollment is PR #20 at
`388507380ae9bc2b1ac91282ff16f40d4c65fcfc`; environments tracks slice B in #108.
No merge, workflow dispatch, live publication/admission, ECR transfer, deployment
or settings change is authorized. The producer PR is dependency-blocked until
the enrollment revision is reviewed and the environments reader/route lands.
The user's pre-existing hybrid-teaching skill changes are preserved in this branch.

## 2. Goals

- Adopt the sibling producers' shared actions and local v3 scanning interface.
- Preserve exact source, image, provenance, workflow, job, run and attempt bindings.
- Preserve existing v1 candidates, historical receipts and explicit rollback.
- Keep shared behavior tests in actions and consumer workflow tests in automation.
- Make each repository's change independently reviewable.

## 3. Non-goals

No application, API, database, Docker runtime, deployment or AWS resource changes.
No vulnerability exemptions, weaker gates, fresh admission-time scan, catalog
refactor, or automatic enrollment from service-authored metadata.

## 4. Current State

### Verified upstream revisions and prerequisites

| Repository          | Inspected upstream main                    | Finding                                                                                        |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| reservation-service | `d81886320726843d06f1a02e30b15e05637a5365` | Separate v1 producer and scanner                                                               |
| actions             | `036531133bcefd454b5afc0eb55f8ba0328901ea` | PR #18 is still latest main; authenticated prepare exists; service enrollment absent           |
| environments        | `3c2f4fdb5dededf0de64752d07bd65dec8dc2f2d` | PR #107 local client, #104 latest selection, #97 v3 hosting, #85 local hosted admission merged |
| recommendation-mcp  | `3d64ee989c200266faa0914cc82106f54b14dd38` | Authenticated-prepare canary producer                                                          |

Environments #87 is CLOSED; its reader implementation PRs #88, #89, #90,
#91 and #93 are merged. Issue #38's final paragraph is stale. Generic v3
capability does **not** mean service-specific v3 enrollment exists.

All five other producers' current main workflows explicitly select v1alpha3,
pass `github-token` to prepare and evidence, and pin both actions plus the PR
tooling checkout to `036531133bcefd454b5afc0eb55f8ba0328901ea`.
Recommendation-MCP's canonical [run 34983609005](https://github.com/movie-reservation-platform-lab/movie-recommendation-mcp/actions/runs/34983609005)
succeeded. Current service v1 [admission 35014382703](https://github.com/movie-reservation-platform-lab/movie-platform-environments/actions/runs/35014382703)
succeeded. The more recent recommendation-MCP latest-selection admission
35002556440 failed; do not treat historical canary success as proof that every
current discovery/admission invocation succeeds. A new service acceptance must
inspect its own exact run and result.

No open service PR or actions enrollment PR was found during inspection.
The environments local branch differs from main despite its PR being merged;
use origin/main for implementation and preserve that checkout.

### Service identities to retain

Sources: service `.github/workflows/ci.yml`,
`automation/candidate-evidence/src/contract.ts`,
`automation/candidate-publication/src/{prepare,record,verify-provenance}.sh`;
environments `config/evidence-sources/reservation-service.json`.

| Identity                       | Required value/binding                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Component                      | `reservation-service`                                                                                                                       |
| Source                         | `movie-reservation-platform-lab/movie-reservation-service`                                                                                  |
| Repository / owner numeric IDs | `1322860483` / `310973053`, verified through GitHub API                                                                                     |
| Workflow                       | ID `326940542`, name `CI`, path `.github/workflows/ci.yml`                                                                                  |
| Job ID and API display name    | Both `publish-candidate`; do not copy siblings' `publish-image`                                                                             |
| Context                        | Canonical repository, `push`, `refs/heads/main`, current authenticated main revision                                                        |
| Image                          | `ghcr.io/movie-reservation-platform-lab/movie-reservation-service@sha256:<64 lowercase hex>`                                                |
| Build                          | Production `runtime`, single `linux/amd64` manifest, Buildx `provenance: false`                                                             |
| Discovery tag                  | `sha-<revision>-run-<runId>-attempt-<attempt>`; never deployment authority                                                                  |
| Artifact                       | `reservation-service-security-evidence-<runId>-attempt-<attempt>`                                                                           |
| Members                        | Versioned candidate JSON, `reservation-service-provenance.json`, `reservation-service.cdx.json`, `reservation-service-vulnerabilities.json` |
| Signer                         | `https://github.com/movie-reservation-platform-lab/movie-reservation-service/.github/workflows/ci.yml@refs/heads/main`                      |
| Trust                          | GitHub OIDC issuer, hosted runner, exact source revision and run/attempt, SLSA v1 image subject, all four package members attested          |

Retain image digest equality across build output, provenance subject, SBOM/report,
candidate and admission result. Bind member hashes to original bytes. Preserve
separate rejected diagnostics and 14-day canonical artifact retention. No registry
attestation fallback tags or fifth canonical member.

### Actions exclusions

- `actions/container-evidence/src/profile.mts`: five-component closed job map.
- `actions/container-evidence/src/exemption-policy.mts`: five-component validator.
- `local-tools/container-security/src/scan.mts`: five-component v3 CLI allowlist.
- `contracts/component-candidate-evidence-v1alpha3.schema.json`: references v2's
  five-component enum and existing identity branches.
- `contracts/container-vulnerability-exemption-v1alpha1.schema.json`: component
  enum and component-to-VEX-product identity conditions.

V2 is a closed historical contract. Add a v3-only service branch and component
choice; do not widen the v2 schema as a shortcut. Shared service evidence must
require explicit v3 selection rather than accidentally emitting unsupported v2.

### Environments support and exclusions

- `candidate_evidence/compatibility.py` already recognizes v3; package verification,
  historical recomputation, retrieval, attestation and current-policy admission
  already support v3 for enrolled producers.
- `container_candidate_profiles.py:43,113` allows only v1 for the service, including
  package membership recognition. `LEGACY_PROFILE` must remain strict v1.
- `hosted_candidate_profile.py:13` selects service v1, all other producers v3.
- `vulnerability_exemptions/records.py:21` excludes the service; vendored candidate
  and exemption schemas also exclude it.
- `config/evidence-sources/reservation-service.json` fixes legacy membership.
  Its binding loader already overlays filenames from an independently selected
  profile after checking committed identity; preserve this file and reuse that
  mechanism (`candidate_evidence_retrieval/infrastructure/binding_file.py:61`).
- V3 integrity, retrieval, trusted-evidence and admission-result schemas also
  inherit v2 identity restrictions. In particular, admission-result v2 excludes
  service component/image/source/ECR identities; update v3-specific constraints.
- `local_automation/publication_discovery/selection.py:79,125` writes and validates
  frozen evidence version from the global hosted map. A plain map flip would
  invalidate historical selections and exact v1 candidate requests.
- `local_automation/local_demo/admission_policy.py` and `admission_cache.py`, and
  `local_automation/container_admission/{client,records}.py`, preserve exact
  publication identities and authenticated historical receipts. Extend routes
  without rewriting those receipts or treating them as fresh policy approvals.
- `.github/workflows/{verify,admit}-reservation-candidate.yml` use the hosted
  selector, frozen latest/exact selection, and conditional current-policy acquisition.

### Production image checks

Service PRs currently build `npm run docker:build` with amd64, scan all severities
including unfixed findings, reject every CRITICAL using local code, and upload
diagnostics. Canonical main publication scans its exact published digest.
Recommendation-MCP's workflow demonstrates shared Node 24 scanning with a pinned
tool checkout, `GH_TOKEN: ${{ github.token }}`, explicit component/version, and
diagnostic upload even when evaluation fails. Match that contract while keeping
the service's runtime target, stable check names and quality prerequisites.

## 5. Requirements and Assumptions

The five sibling implementations are references, not authority to copy their job
identities. Actions owns reviewed approvals; environments independently fetches
current policy once per admission attempt. A failed lookup is an error, not an
empty approval set. Historical producer decisions and current admission decisions
remain separate. No second fetch/expiry gate during an in-flight attempt.

Open review decisions:

1. Accept the explicit environments-operator admission route described below.
2. Approve proposed actions/environments dependency issues before creating them.
3. Select the actual reviewed actions enrollment SHA after its PR lands.

## 6. Proposed Design

Add service support to existing closed profiles. Use a consumer-owned named route
for reservation-service: `legacy-v1` or `governed-v3`. This is a proposed input,
not an existing CLI flag. Both routes retain the same image/source identity;
each chooses one exact schema, file set, receipt method and verification policy
before opening producer evidence. A mismatch fails; never try another route.

Keep omitted inputs on the current service v1 route during preparation. Enable
the explicit v3 route before producer adoption. Operator request metadata selects
the route in the environments protected workflow; neither producer input nor an
archive's version field selects admission policy. There is no policy URL, policy
revision or approval-file override. Current policy remains independently acquired.

Freeze the resolved route with run, attempt, revision and digest. Use the same
resolved route in retrieval, verification, admission, reruns and local requests.
Version request/selection records where necessary rather than adding fields to
closed historical formats. Old records decode explicitly as their old route;
they are not reinterpreted through a mutable default. Evidence fields only confirm
the chosen route. Reject all mixed-version handoffs.

After successful authorized v3 acceptance, a separate environments activation PR
may default **upgraded local clients** to explicitly send v3 for new requests.
The existing hosted API's omitted route retains its v1 meaning permanently;
GitHub dispatch defaults must not silently reinterpret old callers. Hosted UI
users explicitly select the v3 route. Keep strict legacy verification for retained
v1 exact-run candidates and historical receipts. Local clients persist the
resolved route so defaults cannot change pending intent.

## 7. Alternatives Considered

- **Early global service profile flip:** small diff, but breaks current v1
  publication, exact selection and frozen records. Rejected.
- **Inspect evidence then try v3/v1:** convenient, but lets untrusted evidence
  steer policy and permits fallback. Rejected.
- **Reviewed exact-run transition allowlist:** strong consumer authority; can
  bind run/attempt/revision/digest to one route, but adds migration bookkeeping
  for every retained candidate. Viable if operator route selection is rejected.
  Never use numeric run-ID thresholds to infer format.
- **Parallel explicit consumer routes:** recommended; preserves both strict
  contracts and makes operator intent and rollback reviewable.

## 8. API / Interface Changes

No application API changes. Add actions' service component enrollment with v3-only
evidence. Environments gets a closed route input and versioned persisted intent
where needed. Existing unversioned CLI defaults and legacy receipt schemas retain
their meanings. Shared-action prepare requires explicit `github-token`.

## 9. Data Model / Persistence Changes

No service database changes. Do not rewrite old candidate artifacts or cached
receipts. Add a new request/selection version if the route field changes closed
record shape. Retain explicit decoders for existing records. An expired artifact
requires an authorized new canonical run, never reconstructed evidence.

## 10. Security, Privacy, and Abuse Considerations

Keep main-push-only publication, least-privilege job permissions, no app dependency
installation in the privileged publisher, `persist-credentials: false`, and no
`pull_request_target`. PR scanning uses the workflow's read-only token; no PAT,
AWS secret or write permission. Missing central policy access must fail closed.

Preserve authenticated main lookup, exact signer/subject/run bindings, scanner
suppression protections, bounded regular files, isolated scanner configuration,
and approved-policy acquisition semantics. No approval record is created by
enrollment. A v1 route rejects CRITICALs and cannot accept a v3 package.

## 11. Performance, Scalability, and Reliability Considerations

Reuse existing bounded scanner and network timeouts. V3 limits remain 1 MiB
candidate, 4 MiB provenance, 16 MiB each report/SBOM and 768 KiB compact evaluation.
Keep legacy limits unchanged. Resolve latest once and freeze it; reruns must not
silently select another publication. No additional vulnerability scan at admission.

## 12. Implementation Steps

Each slice has its own repository branch/issue/PR. The follow-up request authorizes
creating those implementation PRs and their dependency tracking issues. The
proposed replacement text for service #38 remains for review. Titles and commits
start with `[ai]`.

### A — `[ai] Enroll reservation-service in shared v3 container evidence`

Repository: actions. New dependency issue linked to service #38; local branch
`ai/reservation-service-v3-enrollment` from inspected actions main.

- Add exact `publish-candidate` job ID/display-name profile; preserve five callers.
- Add service to policy and local scanner allowlists and exemption schema with
  its exact VEX product binding. Track temporary lists under actions #10.
- Give v3 its own extended component choice and exact service identity condition;
  leave v2 bytes/acceptance unchanged. Reject service v2 at runtime.
- Regenerate checked-in JS; update action input descriptions and caller docs.
- Test authenticated prepare, bad contexts/jobs, v3 emission/schema/identities,
  no-policy CRITICAL rejection, approved/wrong-component policy, local scanner,
  and unchanged five-consumer legacy behavior. Run `npm run ci`.

This is the smallest first implementation slice. It cannot switch any current
consumer because their pins remain immutable.

### B1 — `[ai] Add reservation-service v3 reader and explicit admission route`

Repository: environments. New dependency issue; separate branch from origin/main.
Depends on A's reviewed contract, not producer activation.

- Update vendored v3/exemption schemas and their source provenance.
- Extend `container_candidate_profiles.py` and `vulnerability_exemptions/records.py`.
- Preserve the existing evidence-source binding; use its existing independently
  selected profile overlay for v3 filenames after validating canonical identity.
- Extend all v3 receipt schemas that inherit v2 component/image/source/ECR
  restrictions without broadening the historical v2 contracts.
- Extend hosted route selection and both workflow interfaces. Propagate route
  through `local_automation/publication_discovery/{selection,workflow}.py` and
  local admission client/demo request/receipt boundaries.
- Keep default v1; add negative mixed-route tests and explicit old-record migration.
- Verify service v3 across package/retrieval/attestation/current-policy/result/local
  receipt layers, alongside unchanged v1 and other five producers.
- Run repository full Python checks, including pytest, Ruff and example validation.

### C — `[ai] Adopt shared v3 evidence and production-image checks`

Repository: service; issue #38, branch `ai/issue-38-shared-evidence-v3`.
Depends on A's reviewed immutable release and B1 deployed reader capability.

- Replace local publication orchestration in `.github/workflows/ci.yml` with
  prepare/evidence calls at the same reviewed A SHA; pass tokens explicitly.
- Use that SHA for the PR/local shared-tool checkout; require explicit v3 and
  component. Keep `publish-candidate`, `container-security-check`, dependency
  jobs, permissions, uncancelled canonical publication, exact runtime build.
- Replace local check mechanics with a thin service build/shared-scan caller.
- Update `automation/repository/test/workflow-contract.test.ts`, local wrapper
  tests, `DEVELOPMENT.md`, `automation/README.md` and relevant README guidance.
- Keep the v1 schema/fixtures and legacy implementation clearly historical until
  rollback acceptance; avoid duplicating new shared behavior tests in service.
- Run `npm run check`, build and appropriate automation regression checks.
- Do not merge/publish within local implementation authority.

### D — Explicitly authorized acceptance; then B2 activation

Use a separate acceptance issue/checklist, not a code PR pretending to prove live
behavior. After explicit authorization, publish one canonical current-main v3
candidate and admit its exact run/attempt/digest via B1's v3 route. Verify local
receipt consumption and independently current policy. No deployment implied.

Only then propose B2: `[ai] Default upgraded reservation-service admission clients to v3`.
Keep old frozen routes and explicit legacy exact-run support. Follow with a
separate optional cleanup PR after rollback needs/artifact retention are reviewed.
After client activation, legacy exact-run selection remains supported. Old
no-lane latest requests encountering a v3 publication fail with explicit upgrade
guidance; do not silently search older candidates or retry another schema.

Dependency order: **A → B1 → C → authorized D → B2**. B1 development can start
against A's reviewed contract before A release, but C must pin the real release.

## 13. Testing Strategy

Offline:

- Actions: all five existing consumers, exact service profile, v3 schema and
  generated runtime, service v2 rejection, full identity mutations, policy lookup
  failure, no/expired/withdrawn/wrong-component approvals, diagnostic separation.
- Environments: v1 continues succeeding; service v3 succeeds only under explicit
  v3 route; no mixed candidate/receipt/selection; current policy fetched once;
  original verified findings reevaluated without scan; legacy CRITICAL rejection.
- Latest selection freezes once; exact selection never searches for replacement.
  Old pending/cached records preserve identity across default activation/rollback.
- Local clients preserve hosted workflow, repository numeric identity, producer
  run/attempt/digest and selected route. Receipt reuse is historical proof, not
  a fresh admission attempt under today's policy.
- Service: PR/manual cannot publish or get write credentials; both action pins
  and scan-tool pin match the reviewed release; explicit prepare token; production
  runtime/amd64, job names and quality gates unchanged. `npm run check`.

Live, separately authorized:

- Current-main authenticated lookup, successful canonical publication, exact four
  attested members and single manifest digest. Inspect job and source identities.
- Exact v3 admission, current-policy SHA and separate producer/current decisions,
  local receipt compatibility, then latest selection of that same publication.
- Retained v1 exact candidate still verifies through strict legacy route.
- Policy/registry access and scanner acquisition errors remain actionable and
  fail closed. Do not create real exemptions or weaken policy to make a canary green.

## 14. Rollout / Migration Plan

1. Land A after review; record its actual immutable release SHA.
2. Land B1 with service default v1 and explicit tested v3 route. Existing v1
   candidates and local clients remain usable.
3. Review C with that SHA in all three pin locations and matching docs/tests.
4. Explicitly authorize C merge/publication and exact v3 admission acceptance.
5. After D succeeds, review B2 to make upgraded clients explicitly request v3;
   preserve the omitted hosted API input's legacy meaning.
6. Keep strict v1 and original cached receipts through the agreed rollback window.

Rollback before C: revert unused reader/enrollment additions only if necessary;
existing pins and v1 producer remain unaffected. Rollback after C: prefer keeping
dual readers, restore producer workflow/local scanner from pre-adoption service
revision, and route newly produced v1 evidence explicitly to legacy verification.
Coordinate any default change first. Existing v3 records must remain explicit v3;
never reinterpret them as v1. Do not roll back to actions `0365311` with a service
shared caller: that release has no service enrollment. Use the original local
producer path, or a reviewed fixed enrollment release.

## 15. Risks and Mitigations

| Risk                       | Impact                                 | Mitigation                                                                    |
| -------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| Global map flip            | Old candidates/receipts break          | Explicit frozen routes; default change last                                   |
| Widening v2 indirectly     | Historical contract changes            | V3-only identity addition and negative v2 tests                               |
| Copying sibling job names  | Provenance/discovery mismatch          | Keep service `publish-candidate`                                              |
| Missing actions release    | Invalid producer pin                   | Block C activation until A reviewed SHA exists                                |
| Central policy unavailable | Incorrect approval if treated as empty | Fail closed; no stale/empty fallback                                          |
| New scanner finds CRITICAL | Migration cannot publish               | Report findings; remediation is separate authorized scope                     |
| Expired legacy artifacts   | Rollback cannot re-admit old run       | Retain receipts, distinguish new admission, publish fresh only with authority |

## 16. Done Criteria

Local progress on September 15:

- Service branch created from inspected main; all pre-existing hybrid-teaching
  changes carried over (two YAML files formatted without semantic changes).
  Producer and PR/local callers now pin the actual enrollment commit, with
  explicit token inputs and v3 evidence. Legacy implementation remains for rollback.
- Actions slice A is PR #20 on `ai/reservation-service-v3-enrollment`.
  `npm run ci` passed: 253 action tests and 40 local-tool tests. Generated output
  was checked using a temporary Git index; the normal index was left unchanged.
  Read-only review reported no blocking enrollment finding.
- Service `npm run check` and build passed: 59 automation, 116 unit and 71
  integration tests. Caller subprocess tests verify pin/auth failures, production
  build arguments and shared scanner failure propagation.
- Real local production-image check passed: 0 CRITICAL, 6 HIGH, no exemptions;
  policy revision `036531133bcefd454b5afc0eb55f8ba0328901ea`, evaluated
  September 15, 2026. This diagnostic scan is not canonical publication/admission.
- Environments B1 implemented under #108: explicit route, strict readers, frozen
  selections, local request compatibility and service v3 hosted offline chain.
  Review findings on schema registries and receipt-version selection were fixed.
- Implementation commits, pushes and PRs are authorized. No merges, workflow
  dispatches, live publication/admission, ECR transfer or deployment performed.

Local implementation complete means reviewed code and offline tests for A/B1/C,
with real consumer pins. Migration complete additionally requires authorized D
and reviewed default activation. A written plan or green offline checks alone do
not prove live publication or admission.

## 17. Review Checklist

- [x] Current main and sibling implementations inspected
- [x] Identity, authority, compatibility and non-goals recorded
- [x] Alternatives, tests, dependency order and rollback recorded
- [ ] Consumer-owned route design approved
- [ ] A enrollment release reviewed and SHA recorded
- [ ] B1 service v3 reader and compatibility routes released
- [ ] C consumer pins reviewed and offline checks pass
- [ ] D live acceptance explicitly authorized and observed
- [ ] B2 new-request default activated after acceptance

### Proposed issue updates (review only)

Replace #38's stale final paragraph with:

> Environments #87 and reader PRs #88/#89/#90/#91/#93 are complete; #97 activated
> v3 for the five enrolled producers, #85 added local hosted admission, and
> #104/#107 delivered latest selection and a local admission client. Reservation
> service remains explicitly on v1. Its migration requires shared-actions
> enrollment, service-specific v3 reader/profile support, an explicit transition
> preserving strict v1, then a producer update to a reviewed enrollment SHA.
> Local planning/implementation does not authorize publication, admission or AWS
> actions. Track the dependency-ordered work in the service's issue-38 plan.

Propose two repository-owned dependency issues matching A and B1/B2 above, plus
an acceptance checklist when live work is requested. Link temporary mappings to
[actions #10](https://github.com/movie-reservation-platform-lab/movie-platform-actions/issues/10)
and [.github #11](https://github.com/movie-reservation-platform-lab/.github/issues/11).
Their catalog design is open and is not a prerequisite platform-wide refactor.
[.github #10](https://github.com/movie-reservation-platform-lab/.github/issues/10)
is historical extraction context; actions is now the shared tooling owner.

## 18. Handoff Prompt for Implementation Agent

Implement one reviewed slice from this plan on that repository's fresh-main
branch. Preserve dirty worktrees. Read its AGENTS and relevant skills. Keep
shared behavior tests in actions and consumer tests in their repositories.
Do not widen legacy schemas, sniff evidence to select admission policy, add
fallback, choose an invented SHA, or mutate remote state. Report file evidence,
offline check results and remaining release dependencies. Use `[ai]` titles.
