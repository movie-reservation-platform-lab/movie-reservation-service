# Implementation Plan: Route Authentication Audits Through the Audit SDK (PR 8a)

## 1. Summary

Issue [#46](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/46), a sub-issue of #34, is the first half of roadmap PR 8 ([movie-platform-infra plan](https://github.com/movie-reservation-platform-lab/movie-platform-infra/blob/main/docs/plans/eventbridge-security-lake-audit-demo.md#pr-8-integrate-the-reservation-service)). The service consumes the workspace audit SDK it incubated in #44, behind an asynchronous recorder port, and still publishes to stdout only. The only behavior change is a bug fix: a rejected demo login stays 401 when audit emission fails.

PR 8b (separate issue, after this merges) adds config-selected publishers, EventBridge composition, the temporary stdout mirror, bounded metrics and any no-op semantics.

## 2. Goals

- Exact-pin the SDK and load it from the CommonJS service on Node 24.
- Ship the SDK (code, runtime dependencies, on-disk JSON Schema) in the production image and prove it with an in-image smoke.
- Make audit acceptance awaitable at both authentication call sites.
- Replace the service-owned builder and sink with the SDK builder and an SDK `AuditPublisher` stdout adapter, keeping stdout lines byte-identical.
- Keep the application layer SDK-independent.
- Fix: wrong credentials + audit unavailable → 401, not 503.

## 3. Non-goals

- EventBridge composition, publisher selection, `AUDIT_*` configuration, mirror decorator, metrics (PR 8b).
- A no-op publisher, a `disabled` failure reason, or any further SDK API change.
- Converting the service to ESM or producing a dual CommonJS/ESM SDK build.
- AWS resources, deployment, or environment promotion.

## 4. Current State (before this branch)

- `src/application/audit/authentication-audit-event.ts` duplicated the SDK builder; output was byte-identical for identical inputs.
- `AuthenticationAuditRecorder.record()` was synchronous; `AuditEventSink.emit()` wrote stdout synchronously.
- The SDK was ESM-only with `import`-only exports, so `require()` from the CommonJS service failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- Docker installed with `--workspaces=false` and ignored `packages/`, so an image would build and then fail at runtime.
- A PR 3 guard test required that the root manifest _not_ depend on the SDK.
- `DemoLoginService.login()` let an audit failure override a credential rejection, so the controller returned 503 for wrong credentials.

## 5. Decisions

| Decision                    | Choice                                                                                                                                                            | Reason                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CommonJS/ESM bridge         | Add a `default` export condition pointing at the same ESM files                                                                                                   | Node 24 `require(esm)` loads it (no top-level await); one module instance, so `instanceof` stays valid. Covered by a packed CommonJS consumer test. Node 24 is the documented minimum. |
| SDK version                 | Bump to `0.1.1` and exact-pin it                                                                                                                                  | The exported surface changed; one version must identify one artifact.                                                                                                                  |
| Fresh-checkout types        | `check` builds the SDK first. In CI, `audit-sdk-*` jobs own every SDK command; `audit-sdk-build` uploads `dist/` and service jobs download it instead of building | Service jobs consume the SDK the way they will after extraction (an installed build), so moving the SDK out only deletes jobs and swaps the download for `npm ci`.                     |
| Port shape                  | `record(): Promise<AuditReceipt>`, rejecting with `AuditEmissionUnavailableError`                                                                                 | Smallest change from the synchronous contract; the GraphQL path already handles that error.                                                                                            |
| Stdout acceptance           | `StdoutAuditPublisher` maps local buffer/write failures to `accepted: false, reason: 'unavailable'`                                                               | Reuses the SDK's bounded reasons; the local detail (`buffer_full`/`write_failed`) still goes to `audit.stdout.failed`.                                                                 |
| Rejected-login policy owner | `DemoLoginService` (application)                                                                                                                                  | "A rejection stays a rejection" is authentication policy; the controller only maps results to HTTP.                                                                                    |
| 401 body without a receipt  | Generic 401, receipt fields omitted                                                                                                                               | Never fabricate an event ID or set optional properties to `undefined` (`exactOptionalPropertyTypes`).                                                                                  |
| Stdout in production        | Allowed temporarily as the rollback lever                                                                                                                         | It is today's behavior. Remove by roadmap PR 10/11; it stays visibly weaker than EventBridge acceptance.                                                                               |

## 6. Implementation Steps

| Step | Change                                                                                                                                                         | Owner        | Status |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| 1    | SDK `default` condition, `0.1.1`, ESM + CommonJS packed consumers                                                                                              | AI           | Done   |
| 2    | Exact-pin, reverse the guard test, SDK build in `check`; separate `audit-sdk-*` CI jobs                                                                        | AI           | Done   |
| 3    | Workspace-aware Dockerfile, runtime SDK files, in-image smoke (`npm run smoke:image:audit-sdk`)                                                                | AI           | Done   |
| 4    | Async recorder port; await at GraphQL middleware, demo login and controller (mechanical, behavior unchanged)                                                   | AI           | Done   |
| 5    | Recorder on SDK builder + providers; `StdoutAuditPublisher`; delete service builder, `AuditEventSink`, duplicated schema; tests on SDK fakes; byte-compat test | AI           | Done   |
| 6    | Rejected-login audit-failure policy                                                                                                                            | **Engineer** | Done   |
| 7    | Docs (`docs/audit-authentication-demo.md`, SDK README, this plan)                                                                                              | AI           | Done   |

## 7. Hybrid Ownership Card (step 6)

```text
Learning target: How an awaited audit result becomes an HTTP outcome, and which
  layer owns that policy (fail closed on success, keep rejections rejected).
Engineer owns: DemoLoginService.login() audit-failure policy and its tests.
  1. Write a failing integration test in test/integration/api/demo-auth.test.ts:
     wrong credentials + publisher reports unavailable -> 401 (today: 503).
  2. Implement the policy in DemoLoginService (login() is already async):
     correct credentials + audit unavailable -> still rejects (existing 503 tests).
  3. Make DemoLoginResult express "no receipt" without fabricated or undefined
     fields (exactOptionalPropertyTypes is on).
Done evidence: the new test fails first, then passes; the existing 503 cases
  pass; `npm run check` is green.
Support level: guided
```

Follow-up: the GraphQL middleware makes the same "rejection beats audit failure" decision in presentation. It moves to the application layer together with auditing verified GraphQL successes (#50); until then the middleware only audits rejections, so it never faces the fail-closed choice.

## 8. Testing Strategy

- Unit: `StdoutAuditPublisher` (byte-exact legacy line, buffer bound, sync/async write failures); recorder (trace/request correlation, injected providers, publisher throw and each failure reason).
- Integration: demo-auth HTTP matrix with the SDK `FakeAuditPublisher`; GraphQL 401 preserved; real-process audit/trace correlation through `tsx`.
- Packaging: packed ESM and CommonJS consumers; the CommonJS case was verified to fail without the `default` condition.
- Image: `smoke:image:audit-sdk` drives the compiled recorder → SDK builder → stdout publisher inside the production image with networking disabled; verified to fail when `dist/` or `contract/` is missing.
- Automation: guard tests for the exact pin, SDK-only commands in `audit-sdk-*` jobs, the artifact hand-off to service jobs, and the image smoke step.

## 9. Risks

| Risk                                                | Mitigation                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `require(esm)` behavior differs on a future runtime | Node 24 pinned in `.nvmrc`, `engines` and base images; CommonJS consumer test in CI.             |
| SDK accidentally adds top-level await               | `require()` would throw `ERR_REQUIRE_ASYNC_MODULE`; caught by the consumer test and image smoke. |
| Image missing SDK files                             | In-image smoke in `container-security-check`.                                                    |
| Stdout contract drift through the SDK               | Byte-exact fixture test against `test/fixtures/audit/platform-audit-contract-v1.json`.           |

## 10. Decision Before PR 8b (resolved 2026-10-05)

Question: should _successful_ authentication block on remote audit acceptance
(roadmap §6.3: fail closed with a bounded timeout), or only on a durable
**local** write relayed asynchronously (outbox/spool)?

Decisions (engineer, 2026-10-05):

- **Target:** the outbox. Successful authentication should eventually wait
  only for a durable local write that a relay forwards to EventBridge
  (evaluated in movie-platform-infra#76). It is not built in 8b.
- **Prepare the seam now:** `AuditReceipt` keeps meaning "a durable store
  accepted this event", so the outbox later replaces the publisher behind the
  same port without changing `DemoLoginService` or the recorder.
- **Interim behavior until the outbox exists:** fail open, plus an alert.
  If the publisher does not accept the event, the credential decision stands
  (200 or 401) without receipt fields; `audit.emit.failed` and the publish
  metrics drive alerting. Login availability does not depend on EventBridge,
  at the cost that an accepted login can exist without an audit event, traced
  only by the operational log. This changes roadmap §6.3 (which failed
  closed with 503) and the 8a behavior; implemented on the #51 branch with a
  `TODO(movie-platform-infra#76)` in `DemoLoginService`.
- No retries in the request path (proposed with the 8b plan).

See `docs/plans/issue-51-audit-publisher-selection.md`.

A replayable fallback for unaccepted events belongs to the outbox, not to
operational logs. 8a only makes `audit.emit.failed` carry the same correlation
fields as `audit.authentication`, so a failed publish stays traceable without
creating a second, unofficial audit trail.

## 11. Done Criteria

- [ ] Issue #46 acceptance checklist satisfied.
- [ ] `npm run check` and `npm run ci` green on a fresh checkout; `git diff --check` clean.
- [ ] `npm run docker:build && npm run smoke:image:audit-sdk` green.
- [ ] Reviewable PR linked to #46 and #34; not merged.
