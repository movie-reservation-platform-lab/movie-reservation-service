---
name: nestjs
description: Use when implementing, refactoring, or explaining NestJS service code, including controllers, modules, providers, GraphQL resolvers, DTOs, validation, and tests; pair with clean-architecture for layer boundaries.
---

Use this skill when the task involves NestJS application code in this standalone
reservation service.

When this skill applies to service structure or dependency boundaries, read `.ai/skills/clean-architecture/SKILL.md` and use that as the source of truth for layers. Read `.ai/skills/typescript/SKILL.md` when the work touches TypeScript types, signatures, or module boundaries.

## Core Principles

- Keep NestJS as the delivery framework, not the whole architecture.
- Put NestJS decorators and framework classes at the presentation/composition boundary.
- Prefer explicit TypeScript types for parameters and return values.
- Avoid `any`; create focused types, DTOs, interfaces, or ports instead.
- Use English names, PascalCase for classes, camelCase for functions and variables, kebab-case for files, and UPPERCASE for environment variables.
- Keep methods short, named with verbs, and focused on one responsibility.
- Prefer composition over inheritance.
- Use one export per file when practical.

## Structure Guidance

Follow the clean-architecture skill for the canonical `domain/`, `application/`, `infrastructure/`, and `presentation/` layers.

Within that layered structure, place NestJS-specific files at the edges:

```text
src/
  app.module.ts
  index.ts
  config.ts
  presentation/
    http/
      health.controller.ts
      health.module.ts
    graphql/
      movie-reservations.resolver.ts
      movie-reservations-graphql.module.ts
      models/
        movie.gql.ts
        reservation-request.gql.ts
      inputs/
        request-reservation.input.ts
```

For very small first steps, create only the folders needed by the current feature, but do not place business behavior directly in controllers or resolvers.

## NestJS Boundary Rules

- Use controllers for REST endpoints such as `/health` and `/ready`.
- Use resolvers for GraphQL operations.
- Use providers to bind use cases and infrastructure implementations.
- Keep controllers and resolvers thin: parse input, call a use case, map output.
- Put business decisions in domain entities or application use cases.
- Put persistence and third-party integrations in infrastructure adapters.
- Use provider tokens when binding application ports to infrastructure implementations.

## GraphQL Guidance

- Preserve the established NestJS code-first GraphQL contract and generated
  schema configuration unless a coordinated contract change explicitly alters
  them.
- Keep GraphQL object models and input classes in `presentation/graphql/`.
- Map GraphQL inputs to application use case input types instead of passing framework DTOs deep into the domain.
- Use classes plus decorators for GraphQL object and input types because
  TypeScript interfaces disappear at runtime; decorators define schema metadata,
  not complete runtime or business validation.
- Keep health checks as REST endpoints; do not use GraphQL as the ALB, ECS, Docker Compose, or Kubernetes health check path.
- Select the existing in-memory or PostgreSQL adapter through composition
  profiles; do not couple resolvers to either persistence implementation.

## Validation

- Inspect the existing boundary before choosing a validation mechanism; do not
  add `class-validator` or `class-transformer` merely because Nest supports them.
- Preserve Zod for environment/configuration parsing and use explicit
  application/domain validation for reservation identifiers, ownership, and
  business invariants.
- Do not mix validation styles without a documented boundary reason.
- Explain that TypeScript checks compile-time structure, while validation protects runtime input.

## Common Module Guidance

Add a shared/common module only when duplication appears or cross-cutting behavior exists.

Good candidates:

- configuration
- decorators
- guards
- interceptors
- exception filters
- common DTOs
- utility providers
- custom validators

Avoid creating a large common module before the first concrete features need it.

## Testing

- Follow Arrange, Act, Assert.
- Name test variables clearly, such as `inputReservationId`, `actualResponse`, and `expectedBody`.
- Unit test domain objects and use cases without starting Nest.
- Test controllers and resolvers through Nest testing utilities when framework behavior matters.
- Add acceptance or e2e tests for each API module once the module has behavior worth protecting.
- Use the repository's existing Vitest runner rather than introducing Jest.

## Repository Teaching Notes

- Tie explanations to the current files in this repository.
- Explain Nest dependency injection through concrete providers and modules.
- Explain decorator metadata when adding GraphQL or validation decorators.
- Call out when a TypeScript type is compile-time only and when a class/decorator exists for runtime behavior.
- Preserve the established NestJS composition, GraphQL, health/readiness,
  authentication, persistence, and worker boundaries unless an issue explicitly
  changes them.
