---
name: clean-architecture
description: Use when designing or reviewing reservation-service domain, application, infrastructure, presentation, port, and dependency-injection boundaries in this NestJS/TypeScript repository.
---

# Reservation Service Clean Architecture

Keep dependencies pointing from framework and infrastructure code toward plain
application and domain behavior.

## Layer Ownership

- `src/domain/`: reservation entities, value objects, identifiers, state
  transitions, and domain errors. Do not import NestJS, GraphQL, Knex, database,
  or telemetry SDKs.
- `src/application/`: use cases and orchestration. Define feature-owned ports
  under `src/application/<feature>/ports/` for persistence, clocks, ID
  generation, workers, telemetry, and external dependencies.
- `src/infrastructure/`: concrete database, authentication, observability,
  configuration, fixture, and external-service adapters.
- `src/presentation/`: HTTP controllers, GraphQL resolvers, DTOs/models,
  middleware, and mapping between transport and application types.
- `src/di/`: NestJS modules, provider tokens, lifecycle integration, and
  composition profiles.

## Boundary Rules

- Keep resolvers and controllers thin: validate/map input, call an application
  operation, and translate output or errors.
- Put business invariants and reservation state transitions in domain or
  application code, not decorators, repositories, resolvers, or workers.
- Let application code define the narrow interface it needs; infrastructure
  implements it and DI binds it.
- Do not create repository god objects. Split read, command, and work-claiming
  capabilities when their responsibilities or consistency needs differ.
- Keep GraphQL models, database rows, and domain objects distinct when their
  contracts evolve for different reasons.
- Add abstractions only for real boundaries or meaningful substitution.

## Reservation Correctness

- Treat ownership, tenant scope, idempotency, duplicate seat requests,
  transaction boundaries, claims, heartbeats, retries, and terminal states as
  explicit application contracts.
- Keep migrations separate from normal application startup.
- Do not hide retryable infrastructure failures as terminal business outcomes.
- Preserve trace/correlation context across asynchronous reservation work
  without coupling domain objects to OpenTelemetry.

## Testing

- Unit test domain state and application use cases through direct construction.
- Use reusable fakes for meaningful ports and focused spies for outbound
  interactions.
- Test DI composition only when provider wiring is the behavior.
- Use integration/e2e tests for GraphQL mapping, Postgres transactions,
  concurrency, authentication, and process boundaries.

## Review Checklist

1. Identify which layer owns the decision.
2. Check dependency direction and framework leakage.
3. Check contract, transaction, concurrency, and error semantics.
4. Keep the change inside the smallest coherent feature boundary.
5. Add tests at the lowest boundary that proves the behavior.
