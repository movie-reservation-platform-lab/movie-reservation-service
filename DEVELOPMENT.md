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

That command discovers only service tests under `test/`. Run CI and repository
automation tests separately:

```bash
npm run test:automation
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
- `tsc -p automation/tsconfig.json --noEmit` for repository automation type safety.
- the dedicated automation Vitest config for CI and repository helper tests.
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

### Hosted CI job boundaries

GitHub Actions keeps each validation concern visible:

- `service-quality`: `format:check`, `lint`, and `typecheck`;
- `automation-quality`: `typecheck:automation` and `test:automation` for CI and
  repository helpers;
- `service-unit-tests`: `test:unit` after quality passes;
- `service-integration-tests`: `test:integration` after quality passes;
- `service-build`: `build` after quality passes;
- `container-security-check`: a read-only local `linux/amd64` image build and
  vulnerability scan after quality passes on pull requests, manual runs, and
  forks; it runs in parallel with the remaining service jobs;
- `publish-candidate`: a `linux/amd64` GHCR build, provenance attestation, and
  exact-digest security evidence gate after the same four jobs pass on a
  canonical-repository push to `main`.

Formatting and linting remain repository-wide checks under `service-quality`.
The concern boundary applies to TypeScript projects and test execution: service
unit/integration commands never discover automation tests, and automation tests
run only in `automation-quality`.

Each service job installs from `package-lock.json` independently with `npm ci`.
Those jobs may update GitHub's npm download cache, but they have no repository,
package, or deployment write authority.
The read-only image job receives only `contents: read`; it does not log in to a
registry or publish an image. It scans the locally tagged image and retains the
complete Trivy JSON report as a 14-day workflow artifact. Draft and ready pull
requests, manual workflow dispatches, and forks always use this path. Only
`publish-candidate` receives `packages: write`, `id-token: write`, and
`attestations: write`, and it uses the ephemeral `GITHUB_TOKEN` rather than a
PAT or separately managed signing key.

Repo-local composite actions keep policy and validation out of the workflow
YAML. `evaluate-container-vulnerabilities` validates that Trivy JSON belongs to
the expected local tag or immutable digest, writes the security summary, and
applies the provisional CRITICAL-only policy. The publisher's
`prepare-container-candidate` action validates the canonical event, constructs
attempt-unique metadata, and rejects a stale `main` revision before registry
login. `record-container-candidate` validates that the digest and tag match the
source/run identity before writing the immutable handoff summary. Their
dependency-free implementations are covered by focused subprocess and workflow
contract tests.

These actions are an intentional local migration seam, not the final
organization API. [The shared CI building-block issue](https://github.com/movie-reservation-platform-lab/.github/issues/5)
owns the reusable workflow, second-container pilot, versioning, and eventual
replacement of these actions with a full-SHA-pinned platform workflow call.

Keep Testcontainers/Postgres e2e separate when it is added later so its Docker
dependency, runtime, and failures remain independently visible. Do not hide it
inside `service-quality`, `npm run check`, or another hosted wrapper.

The pull-request workflow exposes five stable check names. Workflow YAML alone
does not block a merge: after a pull request first produces a successful
`container-security-check`, update the `main` ruleset to require that exact
name. If `container-image-check` is currently required, replace it with the new
name before merging this change while keeping pull-request enforcement enabled.
During a prolonged scanner integration outage, a controlled maintainer may
temporarily remove the required-check entry; the evaluator deliberately has no
fail-open switch.

### Pull-request container security evidence

The PR job builds `movie-reservation-service:local` once and asks Trivy to scan
OS and application/library vulnerabilities. Fixed and unfixed findings are
included, and every severity remains in the JSON report. Trivy produces
evidence without making the final admission decision; the repo-local evaluator
fails the job when one or more CRITICAL findings exist. HIGH findings are
reported but do not block this provisional gate.

When CRITICAL findings exist, the job summary lists each vulnerability ID,
package, installed version, and fixed version, or states that no fix was
reported. The complete JSON report is uploaded with an attempt-unique name and
retained for 14 days, including after a policy failure. Scanner, database,
missing-report, malformed-report, and report-subject failures fail closed.

This PR path intentionally does not publish an image, use registry credentials,
or generate CycloneDX release evidence. Secret, configuration/IaC, license, and
source scanning are also outside this provisional control. The job becomes a
merge gate only when its exact check name is required by the repository
ruleset.

### Reproduce the container security gate locally

Run the complete pull-request container check before pushing:

```bash
npm run container:security-check
```

The command requires Node/npm and a running Docker daemon with a local Unix
socket. It supports standard Docker Desktop, Linux, and rootless Unix-socket
contexts; remote TCP, SSH, and Windows named-pipe contexts are not supported.
A host Trivy installation is not required.

Each run performs the following fail-closed sequence:

1. Builds the production `runtime` target as
   `movie-reservation-service:local` for `linux/amd64`. Repeated builds reuse
   Docker layers, so changing an application dependency or base image normally
   rebuilds only the affected layers.
2. Runs Trivy 0.70.0 from a multi-architecture image pinned by manifest digest.
   The scanner uses the same OS/library scope, severities, unfixed-finding
   behavior, and five-minute timeout as hosted CI.
3. Writes the complete report to
   `security-evidence/reservation-service-vulnerabilities.json`. The generated
   directory is gitignored but remains available for detailed diagnosis.
4. Runs the repository's `evaluate-container-vulnerabilities` implementation,
   prints the same human-readable summary, and exits unsuccessfully when any
   CRITICAL finding exists. HIGH findings remain visible and non-blocking under
   the provisional policy.

The first run may take longer while Docker downloads the pinned scanner and
Trivy downloads its vulnerability database. Later runs reuse the
`movie-reservation-service-trivy-cache` Docker volume while retaining Trivy's
normal database-update behavior. This gives an engineer a short local
build-scan-fix loop without waiting for every hosted CI job.

The scanner container receives the active Docker Unix socket. A read-only
socket mount still grants privileged Docker API access; containerization here
isolates the Trivy installation, not the scanner from the host. The pinned
scanner digest makes that trust decision explicit and reviewable. The local
result is diagnostic evidence only: the required hosted check remains the
merge authority because its clean runner and current database are independently
controlled.

### Candidate publication and first-release checks

The publisher creates this attempt-unique discovery tag:

```text
ghcr.io/movie-reservation-platform-lab/movie-reservation-service:sha-<full-sha>-run-<run-id>-attempt-<attempt>
```

It also adds OCI source, revision, and version labels; records a GitHub-hosted
build-provenance attestation for the exact digest; scans that digest's OS and
application/library packages with Trivy; and records the registry, repository,
full source SHA, digest-pinned image, Actions run URL, and verification command
in the workflow summary. The scan produces a CycloneDX JSON SBOM and complete
vulnerability JSON in a run-attempt-specific artifact retained for 14 days.
The attestation is deliberately not pushed into GHCR because its `sha256-*` OCI
fallback tag is presented by the package UI as an installable image even though
it is not runnable. Downstream automation must use
`ghcr.io/...@sha256:...`, never the discovery tag, as the candidate identity.

The release gate fails on every CRITICAL finding, including findings without a
fix. HIGH findings are reported but remain non-blocking under this provisional
repository policy; a future environment-admission process may consume the
report for its separately governed approval record. Registry, scanner,
vulnerability-database, missing-report, malformed-report, subject-mismatch, and
evidence-upload failures also make the workflow red. The evaluator has no
waiver or fail-open input.

A rerun checks that its source SHA still equals the canonical repository's
current `main` SHA before logging in or pushing. If `main` has already advanced,
the old run fails. This guard is best-effort: `main` can still advance while the
image is building. A valid retry receives a new attempt tag, so it cannot
overwrite a prior result, and downstream admission still selects an explicit
attested digest.

Superseded pull-request, manual, and fork runs are cancelled in event-specific
concurrency groups. Canonical `main` push runs use a separate serialized group
without cancelling an active run, so a manual validation or newer merge cannot
interrupt the short interval between image push and attestation. If several
merges arrive while one run is active, GitHub may replace an older pending run
with the latest cumulative `main` state.

After the first successful `main` publication:

1. Inspect the `publish-candidate` summary and retain its digest and Actions run
   URL together.
2. Download the
   `reservation-service-security-evidence-<run-id>-attempt-<attempt>` artifact.
   Confirm that `reservation-service.cdx.json` and
   `reservation-service-vulnerabilities.json` exist and that the vulnerability
   report's `ArtifactName` equals the digest-pinned candidate in the summary.
3. In the GitHub package settings, verify the package is linked to this source
   repository and change its visibility to public. The workflow deliberately
   does not receive broader credentials to automate that one-time setting.
4. From an unauthenticated environment, pull the exact digest to verify public
   access.
5. Authenticate to GHCR, then run the summary's verification command:

   ```bash
   gh attestation verify oci://ghcr.io/...@sha256:... \
     --repo movie-reservation-platform-lab/movie-reservation-service
   ```

   This command obtains provenance from GitHub's attestation API. Registry-hosted
   attestation bundles, and admission tooling that requires them, remain a
   `movie-platform-environments` concern.

6. Hand the digest, provenance, and security evidence to
   `movie-platform-environments` for its separate admission and promotion
   process.

If the image push succeeds but attestation, scanning, evaluation, evidence
upload, or summary generation fails, GHCR may contain the tagged image while
the workflow is red. A CRITICAL policy failure still uploads the generated
reports before the job finishes. Treat every red digest as ineligible: do not
delete it, promote it, or infer success from its presence. Retry the same run
only if its SHA is still current `main`; otherwise merge a fix or revert so the
cumulative current state creates the next candidate.

## Container Image

Build the baseline-compatible local image:

```bash
npm run docker:build
```

Build the local-only debuggable runtime image:

```bash
npm run docker:build:debug
```

`Dockerfile.dockerignore` uses an allowlist, so the build context contains only
the Docker files, package manifests, `tsconfig.json`, and `src/`. The build
stage uses the root lockfile and the existing `tsconfig.json`; a separate stage
installs production dependencies. Both use the same digest-pinned Node 24
Debian 13 slim base so compiled dependencies retain a consistent glibc/Debian
ABI. A runtime-layout stage collects only `package.json`, `dist/`, and
production `node_modules`.

The default `runtime` target copies that layout into a digest-pinned Distroless
Node 24 Debian 13 `nonroot` image and invokes Node directly. It contains no
shell, package manager, or npm CLI. The workspace is owned by the non-root user
because the current GraphQL configuration writes `schema.gql` beside
`package.json` at startup. Hosted PR scanning and canonical publication build
this target.

The `runtime-debug` target copies the same application layout into the pinned
normal Node/Debian base, runs as its unprivileged `node` user, and retains shell
and npm tooling. Docker Compose explicitly selects this target for local
troubleshooting. It is local-only: do not publish, deploy, or treat its
vulnerability result as candidate evidence. Use the production Distroless
target for production-like demonstrations; switch to the debug target only
when interactive diagnosis is needed.

Base digests are intentionally reviewable inputs. Update their readable tags
and digests together through a reviewed dependency PR; the longer-term update
process remains tracked in repository issue #10.

The host build also compiles `scripts/` and `test/` through the shared
`tsconfig.json`. CI and repository helpers live under `automation/` and are
typechecked separately through `automation/tsconfig.json`; their tests run only
through `test:automation`. All of those paths are intentionally absent from the
production image context. Any future non-`src/` input required to compile the
service must update the allowlist in the same change.

Generated GraphQL schema output remains `schema.gql` under the service root.
`db:migrate` and `db:migrate:status` remain source-mode commands and cannot run
inside the runtime image, which omits `src/` and the development-only `tsx`
runner. Runtime smoke automation, schema-output hardening, and immutable-image
migrations remain dedicated follow-ups. The migration limitation must be
resolved before using this image with a PostgreSQL/RDS-backed environment; it
does not block the current in-memory smoke path.

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
