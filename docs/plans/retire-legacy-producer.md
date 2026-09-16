# Retire the service-owned v1 producer

## Summary and evidence

Follow-up to #38/#39, authorized September 16, 2026. Shared v3 publication
35061320113 and environments admission 35061597029 succeeded for the same
run/attempt and image digest. The admission result explicitly declares
`container-artifact-admission-result-v3`; adoption is no longer merely offline.

## Scope and ownership

Remove four unused `.github/actions/` composites, `automation/candidate-evidence/`,
`automation/candidate-publication/`, the old vulnerability evaluator and
`check-legacy.sh`, their tests/fixtures, obsolete workflow assertions, the schema
generation npm script and lint exceptions. Keep the shared scanner wrapper,
consumer workflow tests, application code and user-owned hybrid teaching skill.
Keep the already published v1 JSON schema immutable for historical references;
rewrite contracts/automation documentation to identify actions as current owner.
Remove a development dependency only if no remaining repository caller uses it.

## Alternatives and risks

Keeping dead executables duplicates security ownership and encourages accidental
reuse. Deleting every old schema would unnecessarily break historical consumers.
Retain contract bytes, remove obsolete execution paths, and use Git history for
code rollback. Shared tooling pins and production workflow behavior stay unchanged.
No application, database, API, policy exemption, admission, deployment or cloud
change belongs here. No new dependencies or network-dependent tests.

## Implementation and tests

1. Resolve exact retired files and their references before deleting tracked files.
2. Remove only those files/configuration and replace legacy-action tests with a
   focused invariant that the active workflow delegates evidence to shared tooling.
3. Update current docs and retain historical plans as dated design records.
4. Run automation typecheck/tests, full `npm run check`, build and diff checks.
5. Read-only review; one issue/branch/PR, `[ai]` commits/title. No merge or live run.

## Rollout, rollback and completion

Independent of environments caller activation: neither PR changes evidence format
or producer pins. Revert this cleanup commit to recover removed implementation;
an actual producer rollback remains a separately reviewed workflow change.
Done means obsolete executables are absent, remaining caller tests pass, current
docs have one owner, and the PR is reviewable with a clean worktree.

Implementation handoff: perform the bounded removals above; preserve archived
schema bytes and all shared trust/credential gates. Escalate any live consumer of
a supposedly retired helper rather than deleting it silently.
