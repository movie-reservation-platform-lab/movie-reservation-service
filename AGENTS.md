# Movie Reservation Service — AI Guidance

## Purpose

This repository owns the NestJS reservation API for the movie reservation
platform. It exposes the reservation GraphQL contract, reservation application
logic, persistence adapters, and service-level observability.

## Repository Rules

- Keep NestJS decorators, modules, resolvers, and dependency injection at the
  outer application edge.
- Keep domain and application logic in plain TypeScript where practical.
- Put feature-owned dependency interfaces under `src/application/**/ports/`.
- Use Zod or framework validation at external boundaries; do not treat
  TypeScript types as runtime validation.
- Do not add AWS resources or mutate platform infrastructure from this repo.
- Publish immutable application artifacts; deployment composition belongs to
  the platform environment/infra repos.
- Preserve local env files and secrets. Templates are fine; rendered env files
  must stay untracked.

## Commands

- Install: `npm ci`
- Dev server: `npm run dev`
- Full local check: `npm run check`
- CI-equivalent check: `npm run ci`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- Build: `npm run build`

Run the narrowest useful check while iterating, then run `npm run check` before
handing back application changes.
