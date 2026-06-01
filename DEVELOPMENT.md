# Service Development

This service uses `package.json` scripts as the local automation entry point.
The goal is that a human developer and CI can run the same commands.

## Mental Model

The service toolchain is split by responsibility:

- `tsx` runs TypeScript directly during local development.
- `tsc` compiles and typechecks TypeScript.
- `vitest` runs tests.
- `prettier` formats code.
- `eslint` runs the established TypeScript lint rules.
- `oxlint` runs a fast Rust-based lint pass that is useful during migration away
  from slower ESLint-only workflows.
- `npm audit` checks installed dependencies against known vulnerability data.
- `npm outdated` shows dependency updates that are available.

This is similar to Python projects that combine `black` or `ruff format`,
`ruff check`, `pyright` or `mypy`, `pytest`, and `pip-audit`. It is also
similar to Rust's `cargo fmt`, `cargo clippy`, `cargo check`, `cargo test`, and
`cargo audit`, except Node does not give you one built-in tool like Cargo. The
project chooses and wires the commands explicitly.

## Daily Commands

Run the service locally with automatic restart:

```bash
npm -w movie-reservation-service run dev
```

That command uses `env_files/local/local-fixed-user.env`. To select a
different local DI profile, run one of the named scripts:

```bash
npm -w movie-reservation-service run dev:local-fixed-user
npm -w movie-reservation-service run dev:local-jwt
```

## WebStorm Run Configurations

Shared WebStorm run configurations live under `.idea/runConfigurations/`.
They use `$PROJECT_DIR$` paths and intentionally avoid secrets.

- `service_debug_local_in_memory` starts the Nest service on the host through
  `tsx` with `env_files/local/local-fixed-user.env`. Use this for normal
  host-based app debugging with the local fixed Aurora actor and in-memory
  persistence.
- `service_debug_local_compose_dependencies` starts the Nest service on the
  host through `tsx` with `env_files/local/local-postgres.env`. Use this when
  the service process should be debugged locally in WebStorm while dependencies
  come from Docker Compose. Today that means Postgres on `localhost:5432`;
  future Compose dependencies should follow the same local host-runner profile
  pattern.
- `node_attach_9229` attaches Chrome/Node debugging to port `9229`. Use it when
  you started a Node process separately with an inspector flag and only want
  WebStorm to attach.

Before running `service_debug_local_compose_dependencies`, start the local
Compose dependencies:

```bash
docker compose up -d postgres
```

The Postgres e2e debug configurations are documented in
[Debug Postgres E2E Tests](../docs/workflows/debug-postgres-e2e-tests.md#debug-from-webstorm).

## Local Postgres Development

The default `dev` command still uses in-memory persistence. Use this mode when
you want the fastest feedback loop and do not need durable state.

Postgres mode is the local durable persistence path. Docker Compose starts only
the database for now; the NestJS API still runs on the host through npm. That
keeps debugging simple while still exercising the same Knex repositories and
migrations that future container and ECS workflows will use.

Start the local database:

```bash
docker compose up -d postgres
```

Run schema migrations explicitly:

```bash
npm -w movie-reservation-service run db:migrate:local-postgres
```

The `:local-postgres` suffix is intentional. Generic scripts such as
`db:migrate` and `db:migrate:status` do not load an env file; they expect
`DATABASE_URL` to be injected by your shell, CI, ECS task, Kubernetes Job, or a
future migration container. The local-postgres scripts are developer
conveniences that load `env_files/local/local-postgres.env` before running the
same migration entrypoint.

Seed the local demo catalog separately from migrations:

```bash
npm -w movie-reservation-service run db:seed:local-postgres
```

Run the API against the Dockerized database:

```bash
npm -w movie-reservation-service run dev:local-postgres
```

The script loads `env_files/local/local-postgres.env`, which sets
`PERSISTENCE_MODE=postgres` and points `DATABASE_URL` at the Compose Postgres
service on `localhost:5432`. The migration and seed scripts use the same env
file only when you choose their `:local-postgres` variants.

Local service profiles bind the Nest HTTP server to `127.0.0.1` by default.
Use an explicit env override such as `HOST=0.0.0.0` only when you intentionally
need to expose the dev server outside the machine.

The local profiles also enable `RESERVATION_WORKER_MODE=fake-in-process`. This
worker is a lightweight in-process data-plane adapter: it polls the shared
repository, claims one request at a time, heartbeats the claim, and processes
the request deterministically. It is intentionally not the long-term separate
worker/service design. The retry model is documented in
[the architecture decisions](../docs/architecture/architecture-decisions.md#adr-013-split-reservation-worker-retry-budgets-by-failure-type).

Check migration status:

```bash
npm -w movie-reservation-service run db:migrate:status:local-postgres
```

Reset the local database when you want a clean durable state:

```bash
docker compose down -v
```

Migrations intentionally do not run during normal API startup. Local development
uses an explicit migration command so the workflow matches the future
ECS/Kubernetes model: run a one-off migration task or job first, then start API
tasks.

When the environment is already injected, use the generic commands instead:

```bash
npm -w movie-reservation-service run db:migrate
npm -w movie-reservation-service run db:migrate:status
```

See [the runbook](../docs/operations/runbook.md#local-docker-compose-checks)
for the operational checklist and reset notes.

## E2E Tests

The service has focused Postgres e2e tests under `test/e2e`. These tests prove
the durable adapter path, not every in-memory behavior.

The default e2e command uses Testcontainers:

```bash
npm -w movie-reservation-service run test:e2e
```

Testcontainers starts a temporary Postgres container, runs migrations, seeds test
data, executes the e2e suite, and then removes the container. This is the best
default for CI-style verification because the database starts clean each run.
It requires a working local Docker runtime.

To run the same e2e tests against a developer-managed database, start Compose
Postgres and use external mode:

```bash
docker compose up -d postgres

TEST_DATABASE_URL=postgres://movie_reservation_service:movie_reservation_service@localhost:5432/movie_reservation_service \
  npm -w movie-reservation-service run test:e2e:external
```

External mode is destructive to the target database: the test harness resets the
`public` schema before running migrations and seeds. Use it only against a
throwaway local database.

For repeat local debugging, render the dedicated Compose e2e env file:

```bash
cp movie-reservation-service/env_files/templates/local/test-e2e-postgres.env.template movie-reservation-service/env_files/local/test-e2e-postgres.env
```

That profile is for host-based npm or WebStorm execution and uses
`localhost:5432`. If the test runner itself runs inside the Compose network,
render `env_files/templates/in-docker/test-e2e-postgres.env.template` instead;
that profile uses the Compose service hostname `postgres`.

Then run a focused e2e test against the Compose database:

```bash
npm -w movie-reservation-service run test:e2e:local-postgres -- \
  -t "creates, processes, and reads a confirmed reservation" \
  --testTimeout 0 \
  --hookTimeout 0 \
  --no-file-parallelism
```

The Postgres e2e harness disables the fake background reservation worker and
drives the processor manually. That keeps debug runs deterministic and avoids a
timer-based worker racing the test's explicit processor call.

See
[Debug Postgres E2E Tests](../docs/workflows/debug-postgres-e2e-tests.md) for
terminal and WebStorm debugging setup, including why Vitest timeouts need to be
disabled while stepping through hooks.

See [the runbook](../docs/operations/runbook.md#local-docker-compose-checks)
for the same commands from an operations perspective.

## Local Authentication Modes

`AUTH_MODE` selects the auth wiring used by the Nest composition module:

- `local-fixed-user` is the default for development. It accepts GraphQL
  requests with no token or any bearer token and authenticates as the fixed
  local Aurora tenant admin.
- `local-jwt` keeps the same `Authorization: Bearer <jwt>` request path, but
  decodes unsigned local JWT claims instead of calling an external IdP. Use this
  when you want to test different users, tenants, roles, or scopes.
- `oidc` is reserved for the future production validator and currently fails
  fast if selected.

Local auth modes are blocked when `NODE_ENV` is `staging` or `production`.
This is a runtime guard only. When real production auth exists, the production
container/image should also exclude local auth implementations and local env
profiles so a misconfigured `AUTH_MODE` cannot accidentally run development
wiring in production.

The committed env templates are intentionally non-secret. Rendered env files
live under `env_files/`, are ignored by git, and are the files the npm scripts
load with `node --env-file`.

The env folders are split by where the Node process runs:

- `env_files/local/` is for host-based npm/WebStorm execution. These profiles
  use `localhost` for services published from Docker Compose.
- `env_files/in-docker/` is for a process running inside the Compose network.
  These profiles use Compose service names such as `postgres`.

Render the standard local and in-docker profiles from the repository root:

```bash
cp movie-reservation-service/env_files/templates/local/local-fixed-user.env.template movie-reservation-service/env_files/local/local-fixed-user.env
cp movie-reservation-service/env_files/templates/local/local-jwt.env.template movie-reservation-service/env_files/local/local-jwt.env
cp movie-reservation-service/env_files/templates/local/local-postgres.env.template movie-reservation-service/env_files/local/local-postgres.env
cp movie-reservation-service/env_files/templates/local/test-e2e-postgres.env.template movie-reservation-service/env_files/local/test-e2e-postgres.env
cp movie-reservation-service/env_files/templates/in-docker/local-fixed-user.env.template movie-reservation-service/env_files/in-docker/local-fixed-user.env
cp movie-reservation-service/env_files/templates/in-docker/local-jwt.env.template movie-reservation-service/env_files/in-docker/local-jwt.env
cp movie-reservation-service/env_files/templates/in-docker/local-postgres.env.template movie-reservation-service/env_files/in-docker/local-postgres.env
cp movie-reservation-service/env_files/templates/in-docker/test-e2e-postgres.env.template movie-reservation-service/env_files/in-docker/test-e2e-postgres.env
```

Use those exact rendered names for the current scripts:

- `env_files/local/local-fixed-user.env` for `dev:local-fixed-user`.
- `env_files/local/local-jwt.env` for `dev:local-jwt`.
- `env_files/local/local-postgres.env` for `dev:local-postgres` and the
  `db:*:local-postgres` scripts.
- `env_files/local/test-e2e-postgres.env` for focused Postgres e2e debugging
  against the Compose database.
- `env_files/in-docker/test-e2e-postgres.env` for a future/containerized e2e test
  runner on the Compose network.

Production-like settings should come from platform-managed environment
variables or secret stores. The
`env_files/templates/platform/production-oidc.env.template` file is only a
shape reference for future production OIDC wiring, not a committed runtime env
file.

`ENABLE_GRAPHIQL` controls whether the unauthenticated GraphiQL HTML landing
page is available at `/graphql`. Local and test profiles set it to `true`;
production-like profiles should set it to `false`.

The runtime flow is intentionally simple:

1. Node loads an env file into `process.env` with `--env-file`, or the platform
   injects environment variables directly.
2. `src/config.ts` parses and validates `process.env` with Zod.
3. Nest modules receive typed config values and select DI wiring.

That maps cleanly to containers: local development can use env files, while ECS
task definitions or Kubernetes ConfigMaps/Secrets can inject the same variables
without changing application code.

## Nest GraphQL Decorator Metadata

Nest GraphQL code-first resolvers rely on runtime decorator metadata. This is
different from normal TypeScript types:

- TypeScript types are erased after compilation.
- Nest decorators run at runtime and inspect metadata through `reflect-metadata`.
- `emitDecoratorMetadata` in `tsconfig.json` tells the TypeScript compiler to
  emit metadata such as `design:paramtypes`.

The service entrypoint imports `reflect-metadata` in `src/app.ts` so the runtime
metadata API exists before Nest loads decorated classes.

There is one extra wrinkle in local development: `npm -w movie-reservation-service run dev` uses
`tsx`, and `tsx` uses esbuild. Esbuild supports decorators well enough to run the
code, but it does not emit TypeScript's `design:paramtypes` metadata. Nest
GraphQL's `@Args()` decorator still reads `design:paramtypes` internally before
using the explicit GraphQL type callback.

That is why resolver arguments that are loaded through `tsx` need explicit
metadata like this:

```ts
@Reflect.metadata('design:paramtypes', [String])
@Query(() => MovieGql, { nullable: true })
async movie(@Args('id', { type: () => ID }) id: string) {
  // ...
}
```

The explicit `@Args('id', { type: () => ID })` tells GraphQL what schema type to
use. The `@Reflect.metadata(...)` line fills the runtime metadata slot that
`tsx` does not emit.

Alternatives:

- Keep the current explicit `@Reflect.metadata(...)` annotations for affected
  resolver methods. This is small and keeps `tsx` fast for local development.
- Run local development from compiled JavaScript with `tsc` and `node`, because
  `tsc` emits decorator metadata when `emitDecoratorMetadata` is enabled.
- Replace the dev runner with an SWC-based runner configured with
  `legacyDecorator: true` and `decoratorMetadata: true`, matching
  `vitest.config.ts`.
- Avoid Nest GraphQL code-first decorators for this layer and use a schema-first
  GraphQL setup. That removes this specific reflection dependency, but it is a
  larger architectural change.

Adding another GraphQL framework is not needed just to solve this. The issue is
the TypeScript runtime metadata emitted by the chosen dev compiler, not Apollo
or the GraphQL schema itself.

Build production JavaScript into `dist/`:

```bash
npm -w movie-reservation-service run build
```

Run the compiled service:

```bash
npm -w movie-reservation-service start
```

Run tests once:

```bash
npm -w movie-reservation-service test
```

Run tests in watch mode while editing:

```bash
npm -w movie-reservation-service run test:watch
```

## Quality Gate

Run the same checks CI should run before a service build:

```bash
npm -w movie-reservation-service run check
```

`check` runs:

- `prettier . --check` for formatting.
- `oxlint . --deny-warnings` for the fast Rust-based lint pass.
- `eslint .` for the established TypeScript lint pass.
- `tsc -p tsconfig.json --noEmit` for TypeScript type safety without writing build output.
- `vitest run test/unit` for fast unit behavior tests.
- `vitest run test/integration` for in-process NestJS and adapter integration tests.

Run the full CI-style command, including the production build:

```bash
npm -w movie-reservation-service run ci
```

`ci` also runs `test:e2e`, so it requires a working Docker runtime for the
Testcontainers Postgres database.

## Formatting And Linting

Format files:

```bash
npm -w movie-reservation-service run format
```

Check formatting without writing files:

```bash
npm -w movie-reservation-service run format:check
```

Run lint rules:

```bash
npm -w movie-reservation-service run lint
```

Run only the fast Oxlint pass:

```bash
npm -w movie-reservation-service run lint:oxlint
```

Run only the ESLint pass:

```bash
npm -w movie-reservation-service run lint:eslint
```

Apply safe automatic lint fixes:

```bash
npm -w movie-reservation-service run lint:fix
```

Apply formatting, import organization, and safe fixes together:

```bash
npm -w movie-reservation-service run fix
```

Prettier, ESLint, and Oxlint have intentionally separate jobs:

- Prettier is the formatter. It avoids style debates.
- ESLint is the compatibility/reference linter. It has the broadest ecosystem.
- Oxlint is the fast linter. It is useful when a team is migrating from an
  ESLint-heavy setup toward faster Rust-based tooling.

TypeScript still needs `tsc --noEmit` because linting is not a replacement for
the compiler's type checker. This is similar to how `ruff` does not fully
replace `pyright` or `mypy`, and `clippy` does not replace `cargo check`.

## Dependency Risk And Updates

Check production dependency vulnerabilities:

```bash
npm -w movie-reservation-service run audit
```

Check all dependency vulnerabilities, including development tools:

```bash
npm -w movie-reservation-service run audit:all
```

Show available dependency updates:

```bash
npm -w movie-reservation-service run deps:outdated
```

Do not run `npm audit fix --force` blindly. It can make breaking dependency
changes. Treat it like a dependency upgrade PR: inspect the proposed changes,
run the quality gate, and keep the lockfile change reviewable.

## Package Manager Note

This repository currently uses `npm` workspaces. That keeps the learning path
boring and compatible with most Node tooling.

`pnpm` is a reasonable future upgrade when install speed, stricter dependency
isolation, or disk usage matters. For now, prefer consistency over switching
package managers early.
