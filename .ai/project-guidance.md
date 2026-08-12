# Project AI Guidance

This repository owns the standalone NestJS/TypeScript reservation API for the
Movie Reservation Platform Lab. It exposes the GraphQL contract, reservation
application logic, persistence adapters, and service-level observability.

## Implementation Provenance

- This service is the history-preserving extraction of
  `golden-path-ecs-template/movie-reservation-service`.
- While repository Issue #1 remains open, treat the golden-path copy as the
  migration and compatibility reference. After Issue #1 closes following its
  CI and smoke-deployment gates, this standalone repository is authoritative
  and the golden-path copy is historical reference only.
- NestJS/TypeScript is the reservation service architecture. Do not import the
  Rust/Axum recommendation baseline into this repository.
- `axum_tools_random_api` branch `demo-multi-service-observability` belongs to
  `movie-recommendation-service`, not this service.

## Repository Layout

- `src/domain/`: framework-free reservation concepts and rules.
- `src/application/`: use cases and feature-owned dependency ports.
- `src/infrastructure/`: persistence, configuration, observability, and other
  concrete adapters.
- `src/presentation/`: NestJS HTTP and GraphQL delivery adapters.
- `test/`: unit, integration, e2e, support, and contract-oriented tests.
- `observability/`: local collector and dashboard configuration.
- `.ai/`: canonical AI guidance, skills, and read-only review agents.

## Development Commands

- Install: `npm ci`
- Development server: `npm run dev`
- Full local check: `npm run check`
- CI-equivalent check: `npm run ci`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- Build: `npm run build`

Inspect `package.json` before inventing additional commands. Run the narrowest
useful check while iterating, then run `npm run check` before handoff.

## Architecture And Contract Rules

- Keep NestJS decorators, modules, resolvers, and dependency injection at the
  outer application edge.
- Keep domain and application logic in plain TypeScript where practical.
- Put feature-owned dependency interfaces under `src/application/**/ports/`;
  infrastructure implements those ports.
- Validate untrusted input at runtime. TypeScript types do not validate GraphQL,
  HTTP, environment, database, or queue payloads.
- Preserve additive GraphQL evolution unless a coordinated consumer migration
  explicitly permits a breaking change.
- Preserve reservation ownership, idempotency, transaction, request-claiming,
  retry, heartbeat, trace, and controlled demo-fault semantics.
- Keep delivery/DORA telemetry out of application request telemetry.

## Repository Boundaries

- This repository publishes an immutable container image.
- `movie-platform-environments` selects image digests and promotion state.
- `movie-platform-infra` owns AWS resources and deployment mechanics.
- Do not add or mutate AWS resources from this repository.

## Testing Guidance

- Prefer real domain/application behavior with reusable fakes for meaningful
  ports and mocks only when the outbound interaction is the behavior.
- Test domain/application logic without starting Nest when possible.
- Use Nest testing utilities when framework composition matters.
- Keep GraphQL/e2e coverage for public behavior, serialization,
  authentication, authorization, and error translation.
- Add disposable-Postgres coverage for idempotency, concurrency, persistence,
  claims, retries, and transactional state transitions.

## Safety

- Do not commit secrets, tokens, local `.env` values, generated cloud state, or
  copied production data.
- Treat authentication, authorization, reservation ownership, idempotency,
  logging, migrations, and retry behavior as explicit design decisions.
- Do not push, deploy, promote, or mutate shared environment state unless the
  user explicitly requests it.

## Planning And Review

- Use `principal-engineer-planner` before non-trivial contract, persistence,
  concurrency, observability, or integration work.
- Use `typescript`, `nestjs`, and `clean-architecture` for implementation
  decisions and `vitest-testing` for test design and organization.
- Save implementation plans under `docs/plans/`.
- Ask review agents for findings first and require file/line evidence.
