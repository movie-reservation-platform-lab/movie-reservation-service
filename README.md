# Movie Reservation Service

NestJS GraphQL API for the movie reservation platform.

This repository is the history-preserving extraction of
`golden-path-ecs-template/movie-reservation-service`. NestJS/TypeScript remains
the service implementation; keep the golden-path copy as the migration
reference until this standalone repository passes CI and an AWS smoke check.

## Local Development

```sh
npm ci
mkdir -p env_files/local
cp env_files/templates/local/local-fixed-user.env.template env_files/local/local-fixed-user.env
npm run dev
```

Useful scripts:

- `npm run check` runs formatting, lint, typecheck, unit tests, and integration tests.
- `npm run test:unit` runs the fast unit suite.
- `npm run test:integration` runs the integration suite.
- `npm run test:e2e` runs Postgres e2e tests with Testcontainers and requires Docker.
- `npm run ci` runs the full local CI wrapper, including e2e tests and build.
- `npm run build` compiles the service into `dist/`.
- `npm run docker:build` builds the baseline-compatible local container image.
- `npm run db:migrate:local-postgres` applies local Postgres migrations.

## Local Compose Stack

The extracted Compose stack supports several feedback levels:

```sh
# Postgres only; run and debug the API on the host.
mkdir -p env_files/local
cp env_files/templates/local/local-postgres.env.template env_files/local/local-postgres.env
docker compose up -d postgres
npm run db:migrate:local-postgres

# OpenTelemetry collector for a host-run API.
docker compose --profile observability up -d otel-collector

# Postgres, collector, and containerized API on http://localhost:3001.
docker compose --profile api up --build
```

The baseline stack uses fixed loopback ports and container names, so run it from
only one checkout or worktree at a time.

See [DEVELOPMENT.md](DEVELOPMENT.md) for env setup, database seeding, local e2e,
debugging, and observability details.

## Container Image

```sh
npm run docker:build
```

The build context is allowlisted to the package manifests, Docker files,
TypeScript configuration, and `src/`. The candidate runtime contains only the
compiled service, production dependencies, and required package metadata on a
digest-pinned Distroless Node 24 Debian 13 non-root base. Local Compose uses a
separate normal Debian debug target with shell and npm access. See
[DEVELOPMENT.md](DEVELOPMENT.md) for the target boundary and update process.

## Hosted CI

Pull requests, manual workflow runs, and fork activity use five stable,
non-publishing checks without repository, package, or deployment write
authority:

- `service-quality` runs formatting, linting, and typechecking;
- `service-unit-tests` runs unit tests;
- `service-integration-tests` runs integration tests;
- `service-build` compiles the service;
- `container-security-check` starts after quality, builds the
  baseline-compatible `linux/amd64` image, and scans its OS and library
  packages with Trivy. CRITICAL findings fail the job; HIGH findings remain
  visible and non-blocking. The complete JSON report is retained for 14 days.

Reproduce that container gate locally before opening or updating a pull request
with `npm run container:security-check`. It builds the production image, runs a
digest-pinned Dockerized Trivy scanner, writes the complete JSON report, and
applies the same CRITICAL-only evaluator. See
[DEVELOPMENT.md](DEVELOPMENT.md#reproduce-the-container-security-gate-locally)
for prerequisites, caching, outputs, and the Docker-socket trust boundary.

Hosted jobs call the focused npm scripts directly. `npm run check` and
`npm run ci` remain local convenience wrappers. A push to `main` in this
canonical repository runs the same four service gates, then replaces the local
image check with `publish-candidate`. That job alone can publish and attest a
`linux/amd64` image in GHCR. The Docker-dependent Postgres e2e suite is not yet
hosted; it will be added later as its own visible job.

Container vulnerability evaluation, candidate preparation, and handoff
recording use tested repo-local composite actions, leaving the workflow focused
on orchestration and explicit permissions. These local actions are the
migration seam for the planned
[organization CI building blocks](https://github.com/movie-reservation-platform-lab/.github/issues/5).

## Deployment Contract

Application CI publishes one attempt-unique discovery tag for each successful,
current `main` run and records the immutable GHCR digest plus GitHub-hosted build
provenance. Retries use a new tag and never move an earlier tag. The digest, not
the tag, is the candidate identity.

`movie-platform-environments` validates and selects candidate digests for
promotion. This service does not know the final destination and does not deploy
or mutate shared infrastructure.

## Source Backlog

Initial extraction work is derived from:

- `golden-path-ecs-template#7`
- `golden-path-ecs-template#28`
- `golden-path-ecs-template#29`
- `golden-path-ecs-template#32`
