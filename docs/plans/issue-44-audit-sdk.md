# Implementation Plan: Extraction-ready TypeScript Audit SDK and Contract

## 1. Summary

Issue [#44](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/44), a real sub-issue of #34, extracts the existing constrained OCSF 1.3 Authentication model into an isolated npm workspace at `packages/audit-sdk`. The package will expose `core`, `eventbridge`, and `testing` entry points, own its schema and canonical examples, and produce a deterministic local release bundle. The NestJS service continues to compose the existing stdout path in this PR.

This is a contract, package-boundary, and AWS-adapter change. It does not change runtime service behavior or AWS infrastructure.

## 2. Goals

- Provide typed construction, runtime validation, size limits, and redaction for the platform's constrained OCSF 1.3 Authentication event.
- Define an asynchronous, transport-neutral `AuditPublisher` port and acceptance result.
- Implement an EventBridge adapter with exact request construction, bounded cancellation, complete response inspection, and safe error mapping.
- Provide deterministic time/UUID providers, a deterministic publisher fake, and canonical fixtures.
- Make every supported consumer surface work from a packed tarball outside the workspace.
- Build a reproducible, versioned package/contract bundle with SHA-256 verification.
- Preserve the service's current stdout composition and behavior.

## 3. Non-goals

- Integrating the SDK into service call sites or making current audit APIs asynchronous.
- Selecting EventBridge in NestJS dependency injection or adding runtime configuration.
- Publishing to npm/GitHub Releases, signing with an external identity, deploying, or calling AWS.
- Adding OCSF event classes beyond Authentication or changing the existing demo authentication behavior.
- Moving the service-owned stdout adapter into the SDK.

## 4. Current State

- `src/application/audit/authentication-audit-event.ts` owns the pure constrained event types, allowlists, normalization, and builder. Callers currently supply time and UUID.
- `src/application/audit/ports/audit-event-sink.ts` is a synchronous, stdout-oriented local-acceptance port.
- `src/infrastructure/audit/request-authentication-audit-recorder.ts` adds request/OTel context and generates time and UUID directly.
- `src/infrastructure/audit/stdout-audit-event-sink.ts` writes the raw `{"audit": event}` line.
- `src/di/audit/create-authentication-audit-recorder.ts` composes only stdout. This must remain true.
- `test/fixtures/audit/` contains one rejected canonical example and a draft-07 JSON Schema. The current unit tests use Ajv only as a dev dependency.
- The repository is currently a single npm package. `automation/repository/test/workflow-contract.test.ts` deliberately rejects workspaces and workspace commands, so it must be updated to assert the new intentional topology and dependency direction.
- Root TypeScript and Vitest configurations include only service/test/script paths, which allows the SDK to use package-local configurations without leaking package tests into service tests.

## 5. Requirements and Assumptions

### Confirmed Requirements

- The package is extraction-ready and imports no service module.
- Service imports, when migrated later, must use public package exports only.
- The EventBridge adapter uses the configured exact bus ARN and a stable package-owned source allowlist, detail type, and envelope version constants.
- `FailedEntryCount`, result cardinality, and every result entry are checked; partial and malformed responses fail.
- Timeout/caller abort is bounded and maps to a transport-neutral result. AWS exception details never escape the adapter.
- Tests make no live AWS calls.
- Package dependencies are minimal and exact-pinned where they affect the released runtime.
- Local artifacts are reviewable but are not externally published.

### Assumptions

- The package starts at version `0.1.0` with a scoped extraction-ready name; the exact registry destination is intentionally deferred.
- `platform-audit/1` and OCSF `1.3.0` remain the contract versions for this PR.
- The packed npm tarball is the package artifact and includes the versioned contract files. A release directory adds a manifest and SHA-256 checksum file; generating it twice from the same tree must produce identical checksums.
- Ajv is preferred as the one core runtime validation dependency so JSON Schema remains authoritative instead of duplicating a hand-written validator. The EventBridge entry point alone owns the exact-pinned AWS SDK dependency.
- A package-owned default maximum serialized event/envelope size will be safely below the EventBridge per-entry limit and tested at its boundary.

### Open Questions

No product decision blocks implementation. Package registry ownership, external signing/provenance, and the later service integration remain intentionally deferred to their own PRs.

## 6. Proposed Design

### Package boundary

```text
packages/audit-sdk/
  contract/
    platform-audit-event-v1.schema.json
    examples/authentication-accepted-v1.json
    examples/authentication-rejected-v1.json
  src/core/
    authentication types and builder
    injected clock/UUID providers
    schema-backed validation and bounded redaction
  src/eventbridge/
    constants, client seam, adapter, safe result mapping
  src/testing/
    deterministic providers, fake publisher, canonical fixtures
  test/
  scripts/
    packed-consumer and reproducible-release verification
  package.json
  tsconfig.json
  vitest.config.ts
```

The package manifest exposes only explicit subpaths. Internal source paths are not exportable. Contract JSON is included in the packed files and exposed through stable contract subpaths or package-resolved files documented for non-TypeScript consumers.

### Core contract

The public builder accepts only allowlisted Authentication fields and injected providers. The default providers use current epoch milliseconds and UUID v4; tests use fixed providers. Runtime validation returns a discriminated success/failure result with bounded issue codes and paths, without echoing rejected values.

Redaction is defense in depth around untrusted optional text/diagnostics: sensitive keys and caller-declared sensitive values are replaced with a stable marker before bounded serialization. Credentials, authorization/cookie headers, tokens, raw claims, payloads, and arbitrary request bodies are absent from the event type and forbidden by validation. The canonical rejected identity remains `unknown`; accepted demo identity remains `demo-user`.

### Publisher port

```ts
interface AuditPublisher {
  publish(event: AuthenticationAuditEvent, options?: AuditPublishOptions): Promise<AuditPublishResult>;
}
```

The discriminated result contains the stable audit event ID, optional transport event ID on acceptance, and one bounded failure reason (`timeout`, `aborted`, `rejected`, `throttled`, `configuration`, or `unavailable`). Programmer/contract invariant violations may throw before transport; AWS error names, messages, request metadata, and stacks do not cross the adapter boundary.

### EventBridge adapter

The adapter accepts a structurally typed client seam so unit tests inject a fake `send` function while production users can pass the AWS SDK client. It emits exactly one `PutEvents` entry containing the exact configured bus ARN, package constants, optional bounded resource identifiers, and serialized OCSF detail. A composed abort signal covers both a caller signal and package timeout.

The response parser requires exactly one result entry, a consistent `FailedEntryCount`, no entry error fields, and a non-empty EventBridge event ID. Any contradiction, partial failure, or malformed response maps to a bounded rejected/unavailable result. AWS exception classification is internal and conservative.

### Release artifacts

`npm pack` runs from the package after a build. A package-local release command writes a versioned review directory containing the npm tarball, contract files, a machine-readable manifest with package/contract versions and source revision, and `SHA256SUMS`. A verification command performs two clean builds, validates the complete checksummed file set, exercises missing/extra/tampered artifacts, and compares independently produced artifact hashes. The separate packed-consumer command installs the tarball into a generated external consumer.

Generated review artifacts stay ignored by Git. Their manifest shape, scripts, and tests are committed.

## 7. Alternatives Considered

### Hand-written runtime validator

- Pros: no core runtime dependency and small install footprint.
- Cons: duplicates the JSON Schema, creates two sources of truth, and makes contract drift likely.
- Decision: reject; use exact-pinned Ajv in the core entry point.

### Import AWS SDK command classes directly throughout the adapter tests

- Pros: fewer local interface declarations.
- Cons: tightly couples tests to SDK internals and encourages broad mocks.
- Decision: keep AWS request creation in the adapter and inject a narrow structural client seam; still test the real `PutEventsCommand` input.

### Keep fixtures under root `test/fixtures`

- Pros: minimal movement.
- Cons: the packed SDK would depend on repository-private paths and could not be extracted independently.
- Decision: move canonical contract artifacts into the package and update service tests to reference only stable package-owned artifacts where needed.

## 8. API / Interface Changes

- Add public package exports for `./core`, `./eventbridge`, `./testing`, and versioned contract artifacts.
- Add `AuditPublisher`, `AuditPublishOptions`, and discriminated `AuditPublishResult` types.
- Add injected `Clock` and `UuidProvider` types/defaults.
- Add stable EventBridge source allowlist, detail type, and envelope version constants.
- Do not change the service's existing `AuditEventSink`, `AuthenticationAuditRecorder`, or NestJS composition in this PR.

## 9. Data Model / Persistence Changes

None. No database, infrastructure, or deployed event-bus changes occur.

## 10. Security, Privacy, and Abuse Considerations

- Use allowlisted input/event shapes and reject additional sensitive fields at runtime.
- Never include rejected values in validation results or adapter diagnostics.
- Bound strings, timestamps, total serialized size, timeout, resources, and result cardinality.
- Preserve unknown identity for rejected authentication.
- Keep exact bus ARN configuration mandatory; source/detail type cannot be caller-controlled.
- Keep AWS errors inside the adapter and expose only bounded classifications.
- Exact-pin released runtime dependencies and include them in lockfile/workspace validation.

## 11. Performance, Scalability, and Reliability Considerations

- Publish one entry per call; batching and retries are deferred because they alter acceptance and identity semantics.
- Serialize and validate once before transport.
- Bound timeout and payload size to protect request capacity.
- Treat EventBridge acceptance as transport acceptance only, never downstream persistence.
- Stable `metadata.uid` allows downstream deduplication and remains unchanged across caller retries.

## 12. Implementation Steps

1. **Introduce the workspace and package boundary**
   - Change: add npm workspace metadata, package-local TypeScript/Vitest/build scripts, exact dependencies, exports, ignore rules, and repository topology validation.
   - Files: root `package.json`, `package-lock.json`, automation repository tests, `packages/audit-sdk/package.json`, package configs.
   - Verification: install/lock validation, dependency graph tests, package typecheck/build skeleton.

2. **Move and strengthen the contract core**
   - Change: move schema/examples and builder/types into the package; add accepted fixture, injected providers, runtime validation, redaction, and size bounds.
   - Files: `packages/audit-sdk/contract/**`, `packages/audit-sdk/src/core/**`, package core tests; update root audit tests only as needed without switching runtime composition.
   - Verification: positive/negative contract matrix, deterministic provider tests, redaction and size tests.

3. **Add the async port and deterministic fake**
   - Change: define transport-neutral publish types and a stateful deterministic fake exposed from `testing`.
   - Files: package core/testing sources and tests.
   - Verification: ordered captures, queued results, reset/isolation, stable IDs.

4. **Add the EventBridge adapter**
   - Change: exact envelope/request shape, timeout/caller abort, safe error mapping, and complete response inspection.
   - Files: `packages/audit-sdk/src/eventbridge/**`, adapter tests.
   - Verification: exact bus/source/detail/envelope, success, partial failure, inconsistent counts, malformed response, timeout, abort, and exception mapping; no network.

5. **Prove package and release boundaries**
   - Change: packed-tarball external consumer and reproducible release/checksum scripts/tests.
   - Files: package scripts, consumer fixture generator, release manifest documentation, root/package commands.
   - Verification: fresh install/compile/run from tarball, all subpaths resolve, checksum tampering fails, two clean builds match.

6. **Document and validate the handoff**
   - Change: document package ownership, compatibility, acceptance semantics, extraction path, and known gaps; keep stdout docs accurate.
   - Files: package README and repository docs/indexes as appropriate.
   - Verification: package-local checks, service checks, `npm run ci`, and `git diff --check`.

## 13. Testing Strategy

- Core unit/contract tests: accepted and rejected fixtures; version, enum, timestamp, UUID, identifier, forbidden field, sensitive value, and serialized-size failures.
- Determinism tests: fixed clock/UUID providers produce byte-identical canonical events.
- Fake tests: fresh state, ordered event capture, deterministic queued results, and abort behavior.
- Adapter tests: inspect real command input through a fake client; success, every partial/malformed form, timeout, caller abort, and bounded safe error mapping.
- Package boundary test: install the `.tgz` into a temporary package with no workspace links, import each public subpath, compile, and execute.
- Release test: verify manifest/checksums and reproduce identical artifacts from the same source state.
- Regression: current service unit/integration/e2e/build plus repository automation and CI-equivalent commands.

## 14. Rollout / Migration Plan

This PR only adds and releases local artifacts. Existing service code remains on stdout. A later PR exact-pins/consumes the package and changes async call sites after infrastructure connectivity exists. Rollback is deletion of the unused workspace package and workspace metadata; no deployed behavior or data needs migration.

## 15. Risks and Mitigations

| Risk                                                                         | Impact | Likelihood | Mitigation                                                                                                    |
| ---------------------------------------------------------------------------- | -----: | ---------: | ------------------------------------------------------------------------------------------------------------- |
| Schema and TypeScript types drift                                            |   High |     Medium | Schema-backed runtime validation plus canonical packed-consumer tests.                                        |
| Workspace leaks service internals into the package                           |   High |     Medium | Dependency-direction automation and packed install outside the repo.                                          |
| EventBridge partial failure appears accepted                                 |   High |     Medium | Check count, cardinality, and every entry through a pure response classifier.                                 |
| Timeout races return twice or leak timers                                    | Medium |     Medium | Compose abort signals once, clear timers in `finally`, and test both abort sources.                           |
| Sensitive values appear in errors/artifacts                                  |   High | Low/Medium | Allowlisted event shape, redaction tests, bounded issue codes, no rejected-value echo.                        |
| Release bundle is host-dependent                                             | Medium |     Medium | Normalize file ordering/metadata, build in temporary directories, compare SHA-256 twice in CI.                |
| Root Docker/service build accidentally ships workspace files or dependencies | Medium |     Medium | Preserve service entry points, verify production dependency layout, and run image/repository contract checks. |

## 16. Hybrid Ownership Card

```text
Learning target: Runtime narrowing of an untrusted AWS response into a transport-neutral TypeScript discriminated union.
AI owns: Workspace/package scaffolding; core types, builder, validation, redaction, providers; publisher port; EventBridge request/timeout/error scaffolding; deterministic fake; fixtures; release tooling; tests and documentation around the reserved slice.
Engineer owns: Implement the pure EventBridge response-inspection behavior (the function that checks result cardinality, FailedEntryCount, every entry's error fields, and accepted transport event ID) in the package file identified after scaffolding.
Done evidence: Focused Vitest cases pass for full acceptance, partial failure, contradictory count, missing/extra entry, entry error, and missing transport event ID; the returned result exposes no AWS error detail.
Support level: guided
```

The AI will stop before this function's implementation, provide its exact signature, relevant AWS response shapes, focused command, and graduated hints. Before reviewing the engineer's attempt, the AI will ask which part they are least confident about and review behavior before style.

## 17. Done Criteria

- [x] Issue #44 remains linked as a sub-issue of #34 and branch `ai/44-audit-sdk` is used.
- [x] Package imports no service module and exposes only explicit public subpaths.
- [x] Contract, redaction, determinism, fake, and EventBridge tests pass without AWS calls.
- [x] Engineer-owned response inspection is integrated and reviewed behavior-first.
- [x] Packed external consumer resolves and runs all public imports.
- [x] Versioned package/contract artifact checksums reproduce and verify.
- [x] Existing stdout service composition and behavior remain unchanged.
- [ ] Package-local build/tests, workspace validation, service build/tests, `npm run ci`, and `git diff --check` pass.
- [ ] Commits use `[ai][#44]` and a reviewable linked PR is opened without merge.

## 18. Review Checklist

- [x] Requirements and non-goals are explicit.
- [x] Existing audit code, contract fixtures, package tooling, CI, and workspace guard were inspected.
- [x] Alternatives and dependency tradeoffs were considered.
- [x] Security, reliability, package extraction, tests, and rollback are covered.
- [x] A meaningful bounded engineer-owned TypeScript behavior is reserved.
- [x] Ownership card agreed before production code.
- [x] Implementation and verification complete.

## 19. Handoff Prompt

```text
Implement docs/plans/issue-44-audit-sdk.md on branch ai/44-audit-sdk.

Keep issue #44 and parent #34 linked. Preserve the current stdout service composition and do not integrate the SDK into running service behavior. Do not publish externally, create a release, call AWS, deploy, or mutate AWS resources. Exact-pin released package dependencies. Use only public package exports across boundaries.

Honor the Hybrid Ownership Card: scaffold and stop before the engineer-owned EventBridge response-inspection function. After their attempt, ask what they are least confident about, review behavior first, then run focused and full verification. Use commit prefix [ai][#44]. Open a reviewable linked PR and do not merge it.
```
