# Implementation Plan: Select the Audit Publisher and Compose EventBridge (PR 8b)

## 1. Summary

Issue [#51](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/51), a sub-issue of #34, is the second half of roadmap PR 8 ([movie-platform-infra plan](https://github.com/movie-reservation-platform-lab/movie-platform-infra/blob/main/docs/plans/eventbridge-security-lake-audit-demo.md#pr-8-integrate-the-reservation-service)). Configuration chooses the audit publisher (`stdout` or `eventbridge`). The EventBridge path uses the SDK adapter with a bounded timeout, an optional best-effort stdout comparison mirror, and bounded publish metrics.

Apart from switching demo login to fail open (§6.0, engineer decision), the application layer does not change. `AuditReceipt` keeps meaning "a durable store accepted this event". In 8b that store is EventBridge; the planned outbox (movie-platform-infra#76) later becomes another `AuditPublisher` behind the same recorder, and `DemoLoginService` stays as it is.

## 2. Goals

- Validate `AUDIT_PUBLISHER`, `AUDIT_EVENT_BUS_ARN`, `AUDIT_PUBLISH_TIMEOUT_MS` and `AUDIT_STDOUT_COMPARISON_MIRROR` at startup, matching the contract infra PR 7 injects.
- Compose `EventBridgeAuditPublisher` with one attempt per request, bounded by the configured timeout.
- During the comparison window, mirror the same built event (same `metadata.uid`) to stdout best-effort.
- Record publish count and latency with bounded attributes only.
- Keep `AUDIT_PUBLISHER=stdout` as the default and the one-variable rollback.

## 3. Non-goals

- Outbox, relay, migration or retry worker (movie-platform-infra#76).
- Auditing successful GraphQL authentication, or moving the GraphQL audit-failure policy (#50). 8b only adds a TODO marker.
- A no-op publisher (decision in §6.5).
- Deploying, mutating AWS resources, or calling AWS from tests.
- Removing the mirror (roadmap PR 10) or the legacy stdout path (PR 11).

## 4. Current State

- `src/di/audit/create-authentication-audit-recorder.ts` always composes `StdoutAuditPublisher` and reads the global `config`.
- `RequestAuthenticationAuditRecorder.record()` builds one event, awaits `publisher.publish(event)`, converts a thrown publisher error into `unavailable`, logs `audit.emit.failed` with correlation fields, and throws `AuditEmissionUnavailableError` on any non-accepted result.
- On `main`, `DemoLoginService` fails closed on success (503) and keeps rejections as 401; the GraphQL middleware keeps rejections as 401. 8b switches demo login to fail open (§6.0); the GraphQL middleware is unchanged.
- The SDK (`packages/audit-sdk`, `0.1.1`, exact-pinned) exports `EventBridgeAuditPublisher(client: EventBridgeClientLike, { eventBusArn, timeoutMs, resources? })`. It validates the ARN shape and a 1–30,000 ms timeout, races `send` against a timer and caller abort, inspects partial `PutEvents` results, and maps errors to bounded reasons. It does not construct the AWS client.
- `@aws-sdk/client-eventbridge` is an SDK dependency only; the service has no direct AWS SDK dependency.
- Metrics use the OpenTelemetry meter in `src/infrastructure/observability/metrics/otel-meter.ts`, with pre-created bounded series (`graphql-operation-metrics.ts`) and an in-memory exporter contract test (`test/integration/observability/service-signal-contract.test.ts`).
- Infra PR 7 (movie-platform-infra#85, merged) injects into the reservation container only: `AUDIT_PUBLISHER=eventbridge`, an exact same-Region, cross-account custom-bus ARN, `AUDIT_PUBLISH_TIMEOUT_MS` (100–5000, default 1000) and `AUDIT_STDOUT_COMPARISON_MIRROR=true`. The private interface endpoint and task-role grant cover only `events:PutEvents` on that ARN.

## 5. Requirements and Assumptions

### Confirmed Requirements

- Roadmap §6.3 outcome matrix with EventBridge as the required publisher.
- Prepare the outbox seam: the target design is a durable local write relayed afterwards, so nothing above the publisher may assume the store is remote (engineer decision, 8a plan §10).
- Until the outbox exists, authentication fails open, plus an alert (engineer decision): an unaccepted audit event never changes the credential decision; the response omits the receipt fields, and `audit.emit.failed` plus publish metrics are the alerting signal. The publish is still awaited within the timeout so an accepted event can return its receipt.
- No retries in the request path (this plan's proposal, §7 Alternative C).
- Configuration selects the publisher; the default stays stdout.
- Metrics carry no event, request, trace or account IDs.

### Assumptions

- The bus is in the deployment Region (infra validates this), so the client Region can be derived from the ARN.
- ECS task-role credentials come from the AWS SDK default provider chain; no credentials are configured by this service.
- The private endpoint uses private DNS, so the default EventBridge endpoint resolves to it.

### Open Questions

- None blocking. The engineer slice (§17) is a proposal and can be reassigned.

## 6. Proposed Design

```text
DemoLoginService / GraphQL middleware        (fail open, §6.0)
  -> AuthenticationAuditRecorder port         (unchanged)
    -> RequestAuthenticationAuditRecorder     (unchanged: builds one event)
      -> AuditPublisher chosen at composition:
         stdout:       Metered(Stdout, role=required)
         eventbridge:  Metered(EventBridge, role=required)
         + mirror:     StdoutComparisonMirror(
                         required = Metered(EventBridge, role=required),
                         mirror   = Metered(Stdout, role=mirror))
```

### 6.0 Fail open on an unaccepted audit event

`DemoLoginService` returns the credential decision whether or not the recorder accepted the event. `DemoLoginResult` becomes `DemoLoginDecision | (DemoLoginDecision & AuditReceipt)`: receipt fields appear only for an accepted event, never as `undefined` (`exactOptionalPropertyTypes`). The controller no longer maps `AuditEmissionUnavailableError` to 503; unexpected recorder errors still surface as 500.

| Credentials | Audit accepted       | Response                                                     |
| ----------- | -------------------- | ------------------------------------------------------------ |
| Accepted    | Yes                  | 200 + receipt                                                |
| Accepted    | No / timeout / throw | 200, no receipt; `audit.emit.failed` with `auth_status_id=1` |
| Rejected    | Yes                  | 401 + receipt                                                |
| Rejected    | No / timeout / throw | 401, no receipt; `audit.emit.failed` with `auth_status_id=2` |

This deliberately departs from roadmap §6.3 (fail closed with 503). Cost: an accepted login can exist without an audit event, traced only by the operational log, which is not a replayable audit record. `TODO(movie-platform-infra#76)` in `DemoLoginService` marks the outbox that closes the gap. The alarm itself (on `audit_publish_total{audit_publisher_role="required",result="failed"}` and on `audit.emit.failed`) is infra-owned.

### 6.1 Configuration

Parse the four variables into one discriminated union, as `DEMO_AUTH` is already derived in `src/config.ts`:

```ts
type AuditPublisherSettings =
  | { readonly publisher: 'stdout' }
  | {
      readonly publisher: 'eventbridge';
      readonly eventBusArn: string;
      readonly timeoutMs: number; // 100–5000, default 1000
      readonly stdoutComparisonMirror: boolean;
    };
```

| Rule                                                                                                                                | Reason                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUDIT_PUBLISHER` defaults to `stdout`                                                                                              | Local, test and existing deployments are unchanged.                                                                                                      |
| `eventbridge` requires `AUDIT_EVENT_BUS_ARN`                                                                                        | Fail at startup, not on the first login. The SDK constructor validates the exact ARN shape during composition, so startup also fails on a malformed ARN. |
| `AUDIT_PUBLISH_TIMEOUT_MS` is an integer in 100–5000 (default 1000)                                                                 | Same bounds and default as infra; narrower than the SDK's 1–30,000.                                                                                      |
| Under `stdout`, the bus ARN and the mirror flag are ignored, not rejected; a present timeout must still be a valid 100–5000 integer | Rollback is flipping `AUDIT_PUBLISHER` alone. Infra always injects the other three; rejecting them would stop the rolled-back task from starting.        |
| Stdout stays allowed in production                                                                                                  | 8a decision: it is the rollback lever until roadmap PR 10/11.                                                                                            |

Startup logs `audit.publisher.selected` with the publisher, mirror flag and timeout, but not the ARN (it contains the audit account ID).

### 6.2 EventBridge composition (SDK change)

Add `createEventBridgeAuditPublisher({ eventBusArn, timeoutMs })` to the SDK `eventbridge` subpath. It builds `new EventBridgeClient({ region: <from ARN>, maxAttempts: 1 })` once and returns `new EventBridgeAuditPublisher(client, config)`. Bump the SDK to `0.1.2` and re-pin.

- `maxAttempts: 1`: AWS SDK v3 retries up to 3 attempts by default. Retrying belongs to a future relay; inside a login request it adds load during throttling and hides failures from the latency and failure metrics. The timeout already bounds the whole call.
- Region from the ARN: one source of truth. A mismatched `AWS_REGION` cannot point the client at the wrong regional endpoint.
- The service never imports `@aws-sdk/*`, so it has no second, possibly divergent pin of the client. Python and Rust SDKs get one place to copy the transport policy from.

### 6.3 Comparison mirror

`StdoutComparisonMirrorAuditPublisher(required, mirror)` implements `AuditPublisher`:

- Awaits `required.publish(event)` and returns its result (or rethrows its error) unchanged.
- In a `finally`, calls `mirror.publish(event)` with the same event object, catching and discarding any result or error. The stdout publisher already reports its own failures (`audit.stdout.failed`), and the metered wrapper counts them.
- Mirrors even when the required publish failed, so the comparison can show events that reached stdout but not EventBridge.

Rust analogy: a struct holding two `Box<dyn AuditPublisher>` that itself implements `AuditPublisher`; Python analogy: a wrapper object with the same `publish` method.

### 6.4 Metrics

`MeteredAuditPublisher(inner, { publisher, role })` wraps any publisher and records:

| Instrument                              | Attributes                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_publish_total` (counter)         | `audit_publisher` (`stdout`/`eventbridge`), `audit_publisher_role` (`required`/`mirror`), `result` (`accepted`/`failed`), `failure_reason` (SDK reason or `none`) |
| `audit_publish_duration_ms` (histogram) | `audit_publisher`, `audit_publisher_role`, `result`                                                                                                               |

A thrown publisher error is counted as `failed`/`unavailable` and rethrown, so the wrapper never changes behavior. Zero series are pre-created by the composition root for each configured publisher and role. Metrics live in the service, not the SDK, which keeps OpenTelemetry out of the SDK.

### 6.5 No no-op publisher

A no-op publisher must return either `accepted: true`, which hands out a receipt for an event no store accepted, or `accepted: false`, which logs every login as an audit failure and trips the alert. Neither is honest, and no current profile needs one: local and test runs use stdout or the SDK `FakeAuditPublisher`. Revisit only with a concrete consumer and an explicit "skipped" result.

### 6.6 Outbox seam

Nothing in 8b may assume the store is remote: the recorder only sees `AuditPublisher` results. The outbox later adds an `OutboxAuditPublisher` (an insert into Postgres, accepted on commit) plus a relay that drives the same `EventBridgeAuditPublisher` with retries; `metadata.uid` is already generated before publishing, so the relay can resend safely and consumers deduplicate.

## 7. Alternatives Considered

### Alternative A: service constructs the AWS client

- Pros: no SDK API change or version bump.
- Cons: the service needs a direct, separately pinned `@aws-sdk/client-eventbridge`; client policy (attempts, Region) is decided per consumer; the version can drift from the SDK's.
- Decision: rejected in favor of the SDK factory (§6.2).

### Alternative B: fire-and-forget EventBridge publish

- Pros: no request latency or EventBridge availability coupling.
- Cons: events are lost silently on failure; successful logins get receipts for unaccepted events.
- Decision: rejected; the non-blocking design is the outbox, not this.

### Alternative C: allow SDK default retries

- Pros: absorbs a single transient 5xx within the timeout.
- Cons: multiplies calls during throttling; failure and latency metrics stop reflecting single-attempt health.
- Decision: rejected for 8b; revisit with comparison latency data if transient failures dominate.

## 8. API / Interface Changes

- SDK `eventbridge`: new `createEventBridgeAuditPublisher(config)`; version `0.1.2`. Existing exports unchanged.
- Service config: four `AUDIT_*` variables (§6.1); `config.AUDIT_PUBLISHER` settings union.
- Service infrastructure: `MeteredAuditPublisher`, `StdoutComparisonMirrorAuditPublisher`, `createAuditPublisher(settings, deps)`.
- No GraphQL, HTTP, application port or audit wire-format change.

## 9. Data Model / Persistence Changes

None.

## 10. Security, Privacy, and Abuse Considerations

- No credentials in configuration; task-role credentials through the default chain.
- The bus ARN is not logged or used as a metric attribute.
- AWS error names and messages stay inside the SDK adapter.
- **Unauthenticated traffic drives audit volume:** every rejected GraphQL token and demo login costs one `PutEvents` request. This is a property of synchronously auditing unauthenticated attempts with any remote sink, not an EventBridge capacity problem. The default `PutEvents` quota in `eu-central-1` is 2,400 requests/s per account (adjustable; 10,000 in `us-east-1`, `us-west-2`, `eu-west-1`), shared by every producer in the workload account. A single reservation-service task is expected to saturate well below that, but the quota is the account-wide ceiling. If it is reached, responses are unchanged (fail open) but those logins go unaudited until throttling ends. Mitigations: `failure_reason=throttled` metrics and alerting; ingress rate limiting (WAF/ALB, infra-owned) as the standard control; the outbox later removes the quota from the success path and lets the relay send up to 10 entries per request.

## 11. Performance, Scalability, and Reliability Considerations

- Each demo login and GraphQL rejection adds one EventBridge round trip, bounded by the timeout (default 1 s). Successful GraphQL requests are not audited (#50), so ordinary reads are unaffected.
- One shared client per process; keep-alive connections reused.
- An in-flight publish at SIGTERM finishes or times out within 5 s, inside the ECS stop timeout.
- Latency: fail open does not remove the wait. Each demo login and GraphQL rejection still awaits the publish for up to the timeout, so a slow EventBridge slows logins by up to `AUDIT_PUBLISH_TIMEOUT_MS`; it no longer fails them.
- Duplicate risk: a call that times out may still have been accepted. The response omits the receipt while an accepted event exists; `metadata.uid` links it to the `audit.emit.failed` log.

## 12. Implementation Steps

| Step | Change                                                                                                        | Files                                                                                                                                                        | Owner                     |
| ---- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| 1    | GraphQL TODO marker (#50); record the §10 decision in the 8a plan                                             | `graphql-authentication.middleware.ts`, `docs/plans/issue-46-audit-sdk-integration.md`                                                                       | AI (done)                 |
| 1b   | Fail open in `DemoLoginService` with `TODO(movie-platform-infra#76)`; controller drops the 503 mapping; tests | `demo-login.service.ts`, `demo-auth.controller.ts`, `demo-auth.test.ts`, `service-signal-contract.test.ts`, `docs/audit-authentication-demo.md`              | AI (done)                 |
| 2    | SDK factory, `0.1.2`, re-pin, tests with a stubbed client (Region from ARN, `maxAttempts: 1`)                 | `packages/audit-sdk/src/eventbridge/**`, `packages/audit-sdk/test/eventbridge/**`, SDK README, root `package.json`, lockfile                                 | AI (done)                 |
| 3    | Config union and validation                                                                                   | `src/config.ts`, `test/unit/config/audit-publisher-config.test.ts`                                                                                           | AI (done)                 |
| 4    | `MeteredAuditPublisher` + audit metric series                                                                 | `src/infrastructure/audit/metered-audit-publisher.ts`, `src/infrastructure/observability/metrics/audit-publish-metrics.ts`, unit tests, signal-contract test | AI (done)                 |
| 5    | `StdoutComparisonMirrorAuditPublisher`                                                                        | `src/infrastructure/audit/stdout-comparison-mirror-audit-publisher.ts`, unit test                                                                            | **Engineer** (scaffolded) |
| 6    | Composition: `createAuditPublisher(settings, deps)`; recorder factory uses it; startup log                    | `src/di/audit/**`, `test/unit/infrastructure/create-audit-publisher.test.ts`                                                                                 | AI (done)                 |
| 7    | Outcome matrix with EventBridge through the HTTP stack, using a fake `EventBridgeClientLike`                  | `test/integration/api/demo-auth-eventbridge.test.ts`; image smoke builds the real client                                                                     | AI (done)                 |
| 8    | Docs                                                                                                          | `docs/audit-authentication-demo.md`, SDK README                                                                                                              | AI (done)                 |

## 13. Testing Strategy

- **SDK:** the factory returns a publisher whose client has the ARN's Region and one attempt; invalid config still throws `AuditPublisherConfigurationError`.
- **Config:** defaults; `eventbridge` without ARN; timeout 99/100/5000/5001/non-integer; stdout with all EventBridge variables set still starts.
- **Metrics:** accepted, each failure reason, thrown error; attributes exactly the bounded set; the signal-contract test lists the new instruments.
- **Mirror:** required accepted + mirror fails → accepted; required failed → failed, mirror still called; required throws → rethrown, mirror still called; the same event object reaches both.
- **Composition:** each settings variant produces the expected publisher graph (checked through behavior with fakes, not `instanceof` chains).
- **Outcome matrix:** accepted/rejected credentials × accepted/`unavailable`/`timeout`/`throttled`/partial failure, with mirror on and off: success always 200 and rejection always 401, with receipt fields only when the event was accepted (§6.0).
- **Regression:** existing demo-auth, GraphQL, audit-trace and image-smoke tests unchanged and green.

## 14. Rollout / Migration Plan

- Merge with default `stdout`: no runtime change for existing deployments.
- Infra PR 7 already injects `eventbridge` + mirror; a new image is promoted through `movie-platform-environments` by the live release checkpoint after roadmap PR 9, not by this PR.
- Rollback: set `AUDIT_PUBLISHER=stdout` (§6.1 guarantees startup), or pin the previous image digest.
- Monitor: `audit_publish_total{result="failed"}` by reason and `audit_publish_duration_ms` p95/p99 during the comparison window before setting alarm thresholds.

## 15. Risks and Mitigations

| Risk                                                                                          | Impact |           Likelihood | Mitigation                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -----: | -------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EventBridge outage or throttling leaves successful logins unaudited                           |   High |           Low/Medium | Deliberate interim (fail open, 8a plan §10); `audit.emit.failed` with correlation fields; failure metrics with an infra-owned alarm; outbox in movie-platform-infra#76.      |
| Invalid-token flood reaches the account `PutEvents` quota (2,400/s default in `eu-central-1`) | Medium |                  Low | Rejections stay 401; throttling visible in metrics; ingress rate limiting is the standard control (infra); quota is adjustable; the outbox removes it from the success path. |
| Rollback blocked by strict config                                                             |   High | Low without the rule | Ignore EventBridge variables under `stdout`; explicit test.                                                                                                                  |
| Mirror changes the required result                                                            |   High |                  Low | Decorator contract tests; the required result is returned before mirror errors can surface.                                                                                  |
| SDK version bump breaks the CommonJS bridge or image                                          | Medium |                  Low | Existing packed-consumer test, CI artifact hand-off, image smoke.                                                                                                            |

## 16. Done Criteria

- [ ] Issue #51 acceptance checklist satisfied.
- [ ] `npm run check` and `npm run ci` green; `git diff --check` clean.
- [ ] `npm run docker:build && npm run smoke:image:audit-sdk` green.
- [ ] Reviewable PR linked to #51 and #34; not merged.

## 17. Hybrid Ownership Card (step 5)

```text
Learning target: the decorator pattern for ports (Rust: a struct that holds two
  `Box<dyn AuditPublisher>` and also implements it), and how `try/finally` in an
  async function keeps a side effect from changing the primary result.
Engineer owns: StdoutComparisonMirrorAuditPublisher (scaffolded: class, contract,
  constructor; publish() rejects until implemented) and its tests.
  1. Write failing tests with two SDK FakeAuditPublisher instances:
     required accepted + mirror failing -> accepted;
     required failed -> same failed result, mirror still called;
     required throwing -> same error, mirror still called;
     both receive the identical event object.
  2. Implement publish() so only the required publisher decides the result.
  3. Add the composition case to test/unit/infrastructure/create-audit-publisher.test.ts:
     eventbridge + mirror -> EventBridge decides the result, stdout receives
     the identical event object.
Done evidence: the tests fail first, then pass; `npm run check` is green.
Support level: guided
```

## 18. Review Checklist

- [x] Requirements are explicit
- [x] Non-goals are explicit
- [x] Existing code conventions were checked
- [x] Alternatives were considered
- [x] Security implications were reviewed
- [x] Scalability and reliability implications were reviewed
- [x] Testing strategy is complete
- [x] Rollout and rollback are defined
- [x] Implementation steps are ordered and concrete

## 19. Handoff Prompt for Implementation Agent

```text
Implement docs/plans/issue-51-audit-publisher-selection.md on branch
ai/51-audit-publisher-selection, commit prefix [ai][#51].

Constraints:
- Do not change DemoLoginService beyond step 1b, the AuthenticationAuditRecorder
  port, AuditReceipt, or the audit wire format.
- No direct @aws-sdk dependency in the service; the SDK owns client construction.
- No in-request retries; no no-op publisher; no AWS calls in tests.
- Leave step 5 (mirror decorator) to the engineer; scaffold only its file
  location if composition needs it to compile.

Verification:
- npm run check
- npm run ci
- npm run docker:build && npm run smoke:image:audit-sdk
- git diff --check
```
