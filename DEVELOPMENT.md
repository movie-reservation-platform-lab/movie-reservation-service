# Service Development

This standalone NestJS service uses `package.json` scripts as the local
automation entry point. The goal is that a human developer and CI can run the
same commands.

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
npm run dev
```

That command uses `env_files/local/local-fixed-user.env`. To select a
different local DI profile, run one of the named scripts:

```bash
npm run dev:local-fixed-user
npm run dev:local-jwt
```

## IDE Debugging

Portable WebStorm run configurations live under `.idea/runConfigurations/`.
All other `.idea/` project and user state is ignored. The shared configurations
use `$PROJECT_DIR$` as the standalone repository root and rely on the project
Node interpreter.

- `service_debug_local_in_memory` starts the service with
  `env_files/local/local-fixed-user.env`.
- `service_debug_local_compose_dependencies` starts the service on the host with
  `env_files/local/local-postgres.env`.
- `service_e2e_debug_local_compose_postgres` runs the focused e2e scenario
  against the developer-managed Compose database.
- `service_e2e_debug_testcontainers_postgres` runs that scenario with a
  disposable Testcontainers database.
- `node_attach_9229` attaches to a Node process already listening for a debugger
  on port `9229`.

Before running the local Postgres profile, render its ignored local env file and
start the Compose dependency:

```bash
mkdir -p env_files/local
cp env_files/templates/local/local-postgres.env.template env_files/local/local-postgres.env
docker compose up -d postgres
```

For e2e debugging, use `npm run test:e2e:local-postgres` after starting the
Compose database. Disable Vitest test and hook timeouts when stepping through
setup code in a debugger.

## Local Postgres Development

The default `dev` command still uses in-memory persistence. Use this mode when
you want the fastest feedback loop and do not need durable state.

Postgres mode is the local durable persistence path. For the recommended debug
loop, Docker Compose starts only the database and the NestJS API runs on the
host through npm. That keeps debugging simple while still exercising the same
Knex repositories and migrations that future container and ECS workflows will
use. The optional `api` Compose profile runs the database, collector, and API
together when host-level debugging is not needed.

Render the ignored local env file, then start the local database:

```bash
mkdir -p env_files/local
cp env_files/templates/local/local-postgres.env.template env_files/local/local-postgres.env
docker compose up -d postgres
```

Run schema migrations explicitly:

```bash
npm run db:migrate:local-postgres
```

The `:local-postgres` suffix is intentional. Generic scripts such as
`db:migrate` and `db:migrate:status` do not load an env file; they expect
`DATABASE_URL` to be injected by your shell, CI, ECS task, Kubernetes Job, or a
future migration container. The local-postgres scripts are developer
conveniences that load `env_files/local/local-postgres.env` before running the
same migration entrypoint.

Seed the local demo catalog separately from migrations:

```bash
npm run db:seed:local-postgres
```

Run the API against the Dockerized database:

```bash
npm run dev:local-postgres
```

Alternatively, after applying migrations, run the complete Compose profile:

```bash
docker compose --profile api up --build
```

The containerized API is available at `http://localhost:3001` by default. Set
`MOVIE_RESERVATION_API_HOST_PORT` to choose a different loopback port.

The script loads `env_files/local/local-postgres.env`, which sets
`COMPOSITION_PROFILE=local-postgres` and points `DATABASE_URL` at the Compose
Postgres service on `localhost:5432`. The migration and seed scripts use the
same env file only when you choose their `:local-postgres` variants.

Local service profiles bind the Nest HTTP server to `127.0.0.1` by default.
Use an explicit env override such as `HOST=0.0.0.0` only when you intentionally
need to expose the dev server outside the machine.

The local profiles also enable `RESERVATION_WORKER_MODE=fake-in-process`. This
worker is a lightweight in-process data-plane adapter: it polls the shared
repository, claims one request at a time, heartbeats the claim, and processes
the request deterministically. It is intentionally not the long-term separate
worker/service design. Retry behavior is split by failure type: expected
business rejections become terminal request state, while retryable storage or
unexpected failures stay in the work-processing path.

### Local Failure Injection

Reservation processor failure injection is disabled by default:

```env
RESERVATION_FAILURE_INJECTION_MODE=disabled
RESERVATION_FAILURE_INJECTION_RATE=0
```

For a controlled on-call demo, enable stable request-id-based failures:

```env
RESERVATION_FAILURE_INJECTION_MODE=stable-random-unexpected-error
RESERVATION_FAILURE_INJECTION_RATE=0.4
RESERVATION_FAILURE_INJECTION_SALT=local-demo-salt
```

The salt and reservation request id are hashed together, so a given request
keeps the same pass/fail decision across retries. When the policy fires, the
processor raises `SeatReservationCommitError`; the persisted request failure
reason remains the existing `unexpected-error` bucket, so no database migration
is required.

Check migration status:

```bash
npm run db:migrate:status:local-postgres
```

Reset the local database when you want a clean durable state:

```bash
docker compose down -v
```

Migrations intentionally do not run during normal API startup. Local development
uses an explicit migration command so the workflow matches the future
ECS/Kubernetes model: run a one-off migration task or job first, then start API
tasks.

When the environment is already injected into a development shell, use the
generic source-mode commands instead:

```bash
npm run db:migrate
npm run db:migrate:status
```

Use `docker compose ps`, `docker compose logs postgres`, and
`docker compose down -v` as the local operational checklist for Compose-backed
Postgres runs.

## Local Observability

The service writes structured JSON logs to stdout and sends OpenTelemetry traces
and metrics to an app-local collector. This keeps logs compatible with ECS and
CloudWatch while still using OTel for traces and business metrics.

Start the collector for host-run development:

```bash
docker compose --profile observability up -d otel-collector
```

Host-run env profiles send OTLP/HTTP to `http://localhost:14318`. In-Docker API
profiles use `http://otel-collector:4318` instead. The app-local collector
forwards traces and metrics to the external Grafana stack collector by default,
and also exposes `http://localhost:18889/metrics` as a local debugging endpoint.

Run the smoke check after the API and collector are up:

```bash
# API running on the host at http://127.0.0.1:3000
npm run smoke:observability

# API running through the Compose api profile at http://127.0.0.1:3001
API_BASE_URL=http://127.0.0.1:3001 npm run smoke:observability
```

The Compose collector exports local Prometheus metrics at
`http://localhost:18889/metrics` and forwards traces and metrics to the
host-local endpoints in `observability/local-collector.env`. This extracted
configuration is local-only and disables TLS for those outbound connections. Do
not point it directly at a remote or untrusted endpoint; use a TLS-validating
collector configuration for remote telemetry.

## E2E Tests

The service has focused Postgres e2e tests under `test/e2e`. These tests prove
the durable adapter path, not every in-memory behavior.

The default e2e command uses Testcontainers:

```bash
npm run test:e2e
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
  npm run test:e2e:external
```

External mode is destructive to the target database: the test harness resets the
`public` schema before running migrations and seeds. Use it only against a
throwaway local database.

For repeat local debugging, render the dedicated Compose e2e env file:

```bash
mkdir -p env_files/local
cp env_files/templates/local/test-e2e-postgres.env.template env_files/local/test-e2e-postgres.env
```

That profile is for host-based npm or WebStorm execution and uses
`localhost:5432`. If the test runner itself runs inside the Compose network,
render `env_files/templates/in-docker/test-e2e-postgres.env.template` instead;
that profile uses the Compose service hostname `postgres`.

Then run a focused e2e test against the Compose database:

```bash
npm run test:e2e:local-postgres -- \
  -t "creates, processes, and reads a confirmed reservation" \
  --testTimeout 0 \
  --hookTimeout 0 \
  --no-file-parallelism
```

The Postgres e2e harness disables the fake background reservation worker and
drives the processor manually. That keeps debug runs deterministic and avoids a
timer-based worker racing the test's explicit processor call.

When debugging from a terminal or IDE, add `--testTimeout 0 --hookTimeout 0` so
Vitest does not fail while execution is paused in setup hooks.

## Local Authentication Modes

`COMPOSITION_PROFILE` is the high-level DI profile. It is the preferred way to
select a supported auth + persistence wiring set:

- `local-fixed-user` uses fixed local auth with in-memory persistence.
- `local-jwt` uses unsigned local JWT claim decoding with in-memory persistence.
- `local-postgres` uses fixed local auth with Postgres persistence.
- `production-oidc` is the future production shape: OIDC auth with Postgres
  persistence.

The templates intentionally do not set `AUTH_MODE` or `PERSISTENCE_MODE`.
`src/config.ts` derives those lower-level modes from `COMPOSITION_PROFILE`.
Re-render local env files from the templates after this refactor so the files
match the documented model. `RESERVATION_WORKER_MODE` stays separate because it
controls the local fake worker runtime, not the auth or repository adapter
selection.

`AUTH_MODE` is the lower-level auth mode derived from `COMPOSITION_PROFILE`:

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

The baseline Compose `api` profile directly loads the committed, non-secret
`env_files/templates/in-docker/local-postgres.env.template`. Rendered
`env_files/in-docker/` files support manual in-container and e2e runner
workflows; the Compose API does not consume them automatically.

The env folders are split by where the Node process runs:

- `env_files/local/` is for host-based npm/WebStorm execution. These profiles
  use `localhost` for services published from Docker Compose.
- `env_files/in-docker/` is for a process running inside the Compose network.
  These profiles use Compose service names such as `postgres`.

Render the standard local and in-docker profiles from the repository root:

```bash
mkdir -p env_files/local env_files/in-docker
cp env_files/templates/local/local-fixed-user.env.template env_files/local/local-fixed-user.env
cp env_files/templates/local/local-jwt.env.template env_files/local/local-jwt.env
cp env_files/templates/local/local-postgres.env.template env_files/local/local-postgres.env
cp env_files/templates/local/test-e2e-postgres.env.template env_files/local/test-e2e-postgres.env
cp env_files/templates/in-docker/local-fixed-user.env.template env_files/in-docker/local-fixed-user.env
cp env_files/templates/in-docker/local-jwt.env.template env_files/in-docker/local-jwt.env
cp env_files/templates/in-docker/local-postgres.env.template env_files/in-docker/local-postgres.env
cp env_files/templates/in-docker/test-e2e-postgres.env.template env_files/in-docker/test-e2e-postgres.env
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

There is one extra wrinkle in local development: `npm run dev` uses
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
npm run build
```

Run the compiled service:

```bash
npm start
```

Run tests once:

```bash
npm test
```

Run tests in watch mode while editing:

```bash
npm run test:watch
```

## Quality Gate

Run the same checks CI should run before a service build:

```bash
npm run check
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
npm run ci
```

`ci` also runs `test:e2e`, so it requires a working Docker runtime for the
Testcontainers Postgres database. The current hosted workflow does not run that
Docker-dependent suite. A follow-up will add it as a separately visible hosted
job; it should not be hidden inside a general quality or test step.

## Container Image

Build the baseline-compatible local image:

```bash
npm run docker:build
```

`Dockerfile.dockerignore` uses an allowlist, so the build context contains only
the Docker files, package manifests, `tsconfig.json`, and `src/`. The build
stage uses the root lockfile and the existing `tsconfig.json`; a separate stage
installs production dependencies. The runtime image receives only
`package.json`, `dist/`, and production `node_modules`.

The host build also compiles `scripts/` and `test/` through the shared
`tsconfig.json`. Those paths are intentionally absent from the production image
context; any future non-`src/` input required to compile the service must update
the allowlist in the same change.

This extraction intentionally preserves the original image behavior:

- the runtime uses the base image's default user;
- generated GraphQL schema output remains `schema.gql` under the service root;
- `db:migrate` and `db:migrate:status` remain source-mode commands and cannot
  run inside the runtime image, which omits `src/` and the development-only
  `tsx` runner.

Non-root execution, runtime image smoke checks, schema-output hardening, and
immutable-image migrations belong to dedicated follow-ups. The migration
limitation must be resolved before using this image with a PostgreSQL/RDS-backed
environment; it does not block the current in-memory smoke path.

## Formatting And Linting

Format files:

```bash
npm run format
```

Check formatting without writing files:

```bash
npm run format:check
```

Run lint rules:

```bash
npm run lint
```

Run only the fast Oxlint pass:

```bash
npm run lint:oxlint
```

Run only the ESLint pass:

```bash
npm run lint:eslint
```

Apply safe automatic lint fixes:

```bash
npm run lint:fix
```

Apply formatting, import organization, and safe fixes together:

```bash
npm run fix
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
npm run audit
```

Check all dependency vulnerabilities, including development tools:

```bash
npm run audit:all
```

Show available dependency updates:

```bash
npm run deps:outdated
```

Do not run `npm audit fix --force` blindly. It can make breaking dependency
changes. Treat it like a dependency upgrade PR: inspect the proposed changes,
run the quality gate, and keep the lockfile change reviewable.

## Package Manager Note

This repository is a standalone `npm` package. That keeps the learning path
boring and compatible with most Node tooling.

`pnpm` is a reasonable future upgrade when install speed, stricter dependency
isolation, or disk usage matters. For now, prefer consistency over switching
package managers early.
