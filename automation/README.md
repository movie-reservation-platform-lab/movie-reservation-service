# Repository Automation

This directory owns CI and repository-control helpers. It is separate from the
reservation service under `src/` and from service tests under `test/`.

- `candidate-evidence/`: candidate-evidence contract and schema generation.
- `candidate-publication/`: candidate identity and handoff helpers used by
  local GitHub composite actions.
- `container-security/`: local and hosted vulnerability-policy evaluation.
- `repository/`: workflow and repository-structure contract tests.

GitHub action manifests remain under `.github/actions/` because GitHub requires
that entrypoint layout. Their executable behavior belongs here and is invoked
relative to `${{ github.action_path }}`, so non-default checkout locations remain
supported.

Run automation checks independently from application tests:

```bash
npm run typecheck:automation
npm run test:automation
```

Root formatting and lint commands intentionally continue to cover the whole
repository. The boundary here separates source ownership, TypeScript projects,
test discovery, and CI test execution; it does not create competing style or
lint policies for service and automation code.
