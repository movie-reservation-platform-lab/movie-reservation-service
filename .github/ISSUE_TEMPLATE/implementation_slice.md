---
name: Implementation slice
about: Track a reviewable reservation-service change
title: ''
labels: ''
assignees: ''
---

Parent: #

## Goal

What should change, and what outcome should be true when this is done?

## Context

Why is this needed now? Link the plan under `docs/plans/`, the roadmap section,
previous PR, or issue that gives the reviewer enough background.

## Scope

- TODO

## Non-goals

- TODO

## Ownership / Learning Mode

Is this normal implementation, hybrid teaching, review-only, or another working
mode? If hybrid teaching applies, name the engineer-owned slice.

## Service Impact

- [ ] No runtime behavior change
- [ ] GraphQL or HTTP contract change (additive / breaking with coordinated consumer migration)
- [ ] Persistence or migration change
- [ ] Authentication, authorization, ownership, or audit semantics
- [ ] Idempotency, transaction, claiming, retry, or heartbeat semantics
- [ ] Observability signals (logs, traces, metrics, audit events)
- [ ] Configuration or environment variables
- [ ] Container image or runtime packaging
- [ ] Audit SDK workspace package (`packages/audit-sdk`) or its contract
- [ ] CI or repository automation only

Notes:

## Repository Boundary

- [ ] Service-only; AWS resources, deployment, and promotion stay in
      `movie-platform-infra` / `movie-platform-environments`
- [ ] Needs a coordinated change in another repository (link it below)

## Acceptance Criteria

- [ ] TODO

## Verification

What commands, tests, image smokes, or manual checks should prove this is ready
for review?

- TODO

## Delivery

Branch: `ai/<issue>-<slug>`

Commit prefix: `[ai][#<issue>]`

## Links

- TODO
