# Repository Automation

This directory owns CI and repository-control helpers. It is separate from the
reservation service under `src/` and from service tests under `test/`.

- `container-security/`: the production-image build wrapper and subprocess
  tests for the pinned shared scanner caller.
- `repository/`: workflow and repository-structure contract tests.

`movie-platform-actions` owns evidence generation, provenance verification,
publication guards, vulnerability policy and shared behavior tests. The service
workflow consumes immutable action pins; local checks use the same tooling
revision. Service-specific tests protect build targets, identities, permissions,
pin alignment and failure propagation. There is no service-owned legacy fallback.

Run automation checks independently from application tests:

```bash
npm run typecheck:automation
npm run test:automation
```

Root formatting and lint commands intentionally continue to cover the whole
repository. The boundary here separates source ownership, TypeScript projects,
test discovery, and CI test execution; it does not create competing style or
lint policies for service and automation code.
