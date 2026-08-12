---
name: typescript
description: Use when designing or refactoring TypeScript types, function signatures, modules, and application structure.
---

Use this skill when the task is mainly about understanding, improving, or teaching TypeScript in this repository.

## Focus areas

- explicit types that improve readability
- safe alternatives to `any`
- clear function signatures
- interfaces vs type aliases
- module boundaries and exports
- compile-time safety vs runtime validation

## Guidance

- Prefer types that make the code easier to explain.
- When introducing a type, explain what bug or confusion it prevents.
- Keep examples concrete and tied to the current codebase.
- Distinguish between what TypeScript checks at compile time and what still needs runtime validation.
- Favor incremental refactors over broad rewrites when teaching.

## Repository context

This standalone repository uses TypeScript for the NestJS reservation API.
Preserve its branded identifiers, explicit state models, application ports, and
runtime validation boundaries. Infrastructure as code belongs to
`movie-platform-infra`, not this repository.
