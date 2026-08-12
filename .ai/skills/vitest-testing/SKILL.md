---
name: vitest-testing
description: Use when creating, refactoring, reviewing, or explaining TypeScript tests with Vitest in this repository, especially for fake-first testing, reusable test doubles, fixture-like setup, NestJS TestingModule tests, e2e tests with supertest, test categorization, and avoiding brittle over-mocking.
---

# Vitest Testing

Use this skill to make TypeScript tests in this repository behavior-focused,
readable, and aligned with the project's fake-first testing preferences.

Pair with `.ai/rules/teaching-mode.md` when explaining testing concepts. Pair with `.ai/skills/typescript/SKILL.md` when adding or refactoring test types, fake implementations, or dependency interfaces. Pair with `.ai/skills/nestjs/SKILL.md` for NestJS module, resolver, controller, or e2e tests.

## Core Testing Preference

- Prefer real domain objects and real application services.
- Prefer fakes over mocks when a dependency has meaningful behavior or state.
- Use mocks/spies only when a fake would be meaningless boilerplate or when the test needs to assert an outbound interaction.
- Keep tests independent; each test should get fresh mutable state.
- Use explicit setup over hidden magic unless shared setup has proven reusable.
- Tell the story in the test name and structure; add comments only for business rules, regressions, race-sensitive behavior, or non-obvious setup.

## Test Double Guidance

Use a fake when:

- the dependency has state across calls
- the fake helps test real application behavior
- the dependency represents persistence, queues, clocks, external clients, or service boundaries
- the implementation can be reused across multiple tests

Use a stub when:

- the dependency only needs to return fixed data
- behavior does not matter to the test
- a full fake would add noise without increasing confidence

Use `vi.fn()` or `vi.spyOn()` when:

- verifying an outbound side effect such as email, event publish, metrics, HTTP call, or retry
- simulating an exceptional path that is hard to trigger with a fake
- the mock is simpler and equally meaningful

Avoid asserting internal method calls unless the interaction itself is the behavior.

## Reusable Test Support

Start local. Extract only after repetition appears.

Recommended growth path:

1. Inline setup inside one test.
2. Local helper function inside one test file.
3. `beforeEach` inside one `describe` block.
4. Shared fake or factory under `test/support/` when reused across files.
5. Vitest `test.extend` fixture only when fixture-style setup is reused and improves clarity.

Suggested layout when duplication exists:

```text
test/
  support/
    factories/
      booking.factory.ts
    fakes/
      fake-booking.repository.ts
    fixtures/
      booking-service.fixture.ts
  application/
  infrastructure/
  di/
  e2e/
```

Do not create this structure upfront. Let real duplication justify it.

## Fixture Mental Model

Use these equivalents:

- Small data setup: factory functions such as `createBooking()`.
- Fresh mutable state per test: `beforeEach`.
- Reusable fixture-style setup: `test.extend`.
- Nest dependency overrides: `TestingModule.overrideProvider(...)`.
- App lifecycle setup/teardown: `beforeAll` and `afterAll`, or fixture cleanup.

Avoid giant shared fixture files. If using shared setup, keep it close to the tests that need it and split by domain or test category.

## Test Categories

Use these categories when proposing structure, scripts, or CI placement:

- **Unit tests**: domain logic and application services with direct construction; no Nest app startup; fakes/stubs for ports.
- **Thin integration tests**: integration between parts of the same service, such as application service plus in-memory repository, resolver plus service, or DI composition.
- **E2E tests**: whole service/app setup through HTTP or GraphQL, usually with fake/in-memory infrastructure.
- **In-cluster system/smoke tests**: production-like environment tests against test tenants in dev/staging/prod; can include smoke, performance, load, and deployment quality gates.

Prefer directory or script separation for categories. Do not force every category into the same Vitest config unless that is already the project pattern.

## Implementation Workflow

When adding or refactoring tests:

1. Inspect the production boundary being tested.
2. Identify the real behavior worth protecting.
3. Choose the smallest test category that gives confidence.
4. Prefer direct construction for unit/application tests.
5. Create fakes for dependency ports when behavior/state matters.
6. Use `TestingModule` only when Nest wiring or framework behavior matters.
7. Use e2e tests for request/response behavior and serialization/schema coverage.
8. Run the relevant test/typecheck command when possible.

## Documentation Resources

Read `references/examples.md` when you need concrete Vitest examples for:

- factories
- fakes
- stubs
- `beforeEach`
- `test.extend`
- Nest provider overrides
- e2e tests
- comments/storytelling inside tests
