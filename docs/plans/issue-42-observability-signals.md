# Implementation Plan: Verify Reservation Service Observability Signals

## 1. Summary

Verify the existing HTTP, GraphQL, and reservation-worker telemetry against the
advisory five-backend signal contract. Repair only observed gaps: bounded HTTP
route/outcome labels, health-check exclusion, active span correlation in logs,
and exporter-backed evidence covering success and failure paths.

## 2. Goals

- Prove HTTP 2xx, 4xx, and 5xx metrics without counting health traffic.
- Prove GraphQL success and business failure when both use HTTP 200.
- Prove reservation-worker success/failure metrics and trace continuation.
- Document exact names, units, attributes, zero/idle/stale behavior, and limits.

## 3. Non-goals

- Changing public API, authentication, audit, reservation, or retry behavior.
- Adding cloud resources, collector configuration, dashboards, or deployment.
- Inventing traffic or zero-duration histogram observations.

## 4. Current State

`RequestContextMiddleware` records custom HTTP counters and histograms, the
Apollo plugin records bounded GraphQL outcomes, and
`OtelMovieReservationObservability` records worker outcomes. GraphQL and worker
metric series are initialized to zero. Worker trace context is persisted with
the work item and extracted for a consumer span. Gaps found during inspection:
HTTP routes use the raw URL, health traffic is included in metrics, HTTP status
and outcome labels are incomplete, and the shared logger emits an active trace
ID without its active span ID. There is no local metric-export payload test.

## 5. Requirements and Assumptions

### Confirmed Requirements

- Keep labels bounded and preserve GraphQL HTTP-200 business-error semantics.
- Keep telemetry failure fail-open and preserve authentication audit behavior.
- Local evidence must use the real OTel metric/export path.

### Assumptions

- Known Nest routes can be normalized after routing; unmatched paths use the
  single `unmatched` value.
- Existing GraphQL and worker outcome vocabularies are the canonical bounded
  producer values unless payload evidence disproves them.

### Open Questions

- None block implementation. Infra will map the verified producer names after
  reviewing emitted payloads.

## 6. Proposed Design

Normalize known HTTP routes at the finish callback, exclude `/health` and
`/ready` from user-path metrics, and attach bounded method, route, status code,
status class, and outcome attributes. Enrich structured logs with the real
active span ID. Add focused unit/integration assertions plus a local OTLP/HTTP
JSON collector test that exercises the actual service and inspects exported
resource metrics and spans.

## 7. Alternatives Considered

### Rely only on function spies

- Pros: small and fast.
- Cons: does not prove SDK/exporter payload shape or resource identity.
- Decision: rejected as insufficient evidence.

### Replace existing custom metrics with a new shared library

- Pros: could standardize all services immediately.
- Cons: broad coupling and migration risk before observed payloads are known.
- Decision: rejected; keep this producer-specific repair.

## 8. API / Interface Changes

No public API changes. Metric attributes become more explicit and bounded.

## 9. Data Model / Persistence Changes

None.

## 10. Security, Privacy, and Abuse Considerations

Do not add request bodies, credentials, raw GraphQL documents, arbitrary URLs,
user IDs, request IDs, trace IDs, or exception messages as metric labels. Keep
existing audit redaction and fail-closed audit behavior unchanged.

## 11. Performance, Scalability, and Reliability Considerations

The added labels have finite vocabularies. Export remains asynchronous and
fail-open. Health traffic no longer distorts user-path availability metrics.

## 12. Implementation Steps

1. Repair the HTTP metric boundary.
   - Normalize routes, exclude health/readiness, and emit bounded outcome data.
   - Verify exact count and label behavior with focused tests.
2. Complete log correlation.
   - Add the active span ID beside the existing active trace ID.
   - Verify request and worker logs use real active context only.
3. Add exporter-backed contract evidence.
   - Exercise HTTP, GraphQL, and worker success/failure paths.
   - Assert resource identity, names, units, aggregation, labels, counts, and
     trace parenting from collected payloads.
4. Document the observed contract.
   - Record queries, zero/idle/stale semantics, and ECS process/task limits.

## 13. Testing Strategy

- Unit-test route normalization, health exclusion, and log enrichment.
- Integration-test GraphQL HTTP-200 success/failure and worker outcomes.
- Capture real local OTLP metrics/traces for payload evidence.
- Run `npm run check`, relevant integration tests, `npm run build`, and
  `git diff --check`.

## 14. Rollout / Migration Plan

Publish an immutable image after merge. The environment repository will select
compatible producer digests in a separate change. Rollback restores the prior
composition; this PR performs no deployment.

## 15. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
| --- | ---: | ---: | --- |
| Route labels remain unbounded | High | Medium | Allow known templates and collapse unmatched routes. |
| Missing traffic appears healthy | High | Medium | Document missing/stale separately from real zero. |
| Telemetry breaks requests | High | Low | Preserve SDK fail-open behavior and regression test it. |
| Audit behavior changes | High | Low | Keep audit code untouched and run its tests. |

## 16. Done Criteria

- Required local payload evidence exists and is documented.
- Demonstrated metric/log/trace gaps are repaired.
- Public behavior and audit guarantees remain unchanged.
- Repository checks pass and the PR links issue #42.

## 17. Review Checklist

- [x] Requirements and non-goals are explicit
- [x] Existing code conventions were checked
- [x] Alternatives were considered
- [x] Security and reliability implications were reviewed
- [x] Testing, rollout, and rollback are defined

## 18. Handoff Prompt for Implementation Agent

```text
Implement docs/plans/issue-42-observability-signals.md. Preserve the public API,
audit behavior, and existing clean-architecture boundaries. Add no production
dependency unless payload evidence requires it. Run npm run check, focused
integration evidence, npm run build, and git diff --check.
```
