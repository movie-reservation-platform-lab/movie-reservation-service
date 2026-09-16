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

## Authentication Audit Demo

The opt-in `/demo/auth/login` credential check emits OCSF audit events on stdout
for FireLens routing. It leaves the existing reservation demo's authentication
unchanged. See [the demo guide](docs/audit-authentication-demo.md) for setup,
request examples, correlation fields and delivery limits.

## Screening Availability

The additive `screeningAvailability(screeningId: ID!)` GraphQL query returns
`screeningId` and `seats { seatId available }`. Existing catalog/Seat fields are
unchanged. It uses the authenticated actor's provider scope; unknown or foreign
screenings return `null`, and no reservation owner information is disclosed.

Only confirmed reservations occupy seats. Pending requests are not holds, and a
snapshot cannot guarantee a later booking: existing transactional conflict
checks remain authoritative. The reader supports both in-memory and PostgreSQL
profiles without a migration. In-memory bookings survive browser reload, not API
restart, task replacement or multiple independent replicas.

Deploy this API before the frontend availability consumer. See
[the contract and implementation plan](docs/plans/issue-36-screening-availability.md).
The demo credential-check endpoint still does not issue a security session or
change the reservation API's configured actor; a frontend demo gate cannot
replace backend authentication.

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

Pull requests, manual workflow runs, and fork activity use six stable,
non-publishing checks without repository, package, or deployment write
authority:

- `service-quality` runs formatting, linting, and typechecking;
- `automation-quality` checks repository automation and caller contracts;
- `service-unit-tests` runs unit tests;
- `service-integration-tests` runs integration tests;
- `service-build` compiles the service;
- `container-security-check` starts after quality, builds the
  baseline-compatible `linux/amd64` image, and scans its OS and library
  packages with shared Trivy tooling and current, reviewed exemption policy.
  Unapproved CRITICAL findings fail; HIGH findings remain visible. Complete
  diagnostics are retained for 14 days. Policy lookup errors fail closed.

Reproduce that container gate locally before opening or updating a pull request
with `npm run container:security-check`. It builds the production image, runs a
digest-pinned Dockerized Trivy scanner, writes the complete JSON report, and
applies the same governed v3 policy (authenticated policy access is required). See
[DEVELOPMENT.md](DEVELOPMENT.md#reproduce-the-container-security-gate-locally)
for prerequisites, caching, outputs, and the Docker-socket trust boundary.

Hosted jobs call the focused npm scripts directly. `npm run check` and
`npm run ci` remain local convenience wrappers. A push to `main` in this
canonical repository runs the same four service gates, then replaces the local
image check with `publish-candidate`. That job alone can publish and attest a
`linux/amd64` image in GHCR. It scans the exact published digest, retains a
CycloneDX SBOM and complete vulnerability JSON for 14 days, and rejects unapproved
CRITICAL findings before recording the v1alpha3 handoff. HIGH findings remain
visible; environments independently evaluates the original verified report
against current policy before admission. The Docker-dependent
Postgres e2e suite is not yet hosted; it will be added later as its own visible
job.

Shared preparation and evidence actions plus local scan tooling use one immutable
`movie-platform-actions` revision. Retired local producer implementations have
been removed; Git history retains them for reviewed rollback. The published v1
schema remains an immutable historical contract, not an active producer path.
See [the migration plan](docs/plans/issue-38-shared-evidence-v3.md) for dependency
order and the explicit environments `governed-v3` admission route.

## Deployment Contract

Application CI publishes one attempt-unique discovery tag for each successful,
current `main` run and records the immutable GHCR digest plus GitHub-hosted build
provenance and governed v1alpha3 security evidence. Retries use a new tag and never
move an earlier tag. The digest, not the tag, is the candidate identity.

`movie-platform-environments` validates and selects candidate digests for
promotion. This service does not know the final destination and does not deploy
or mutate shared infrastructure.

## Source Backlog

Initial extraction work is derived from:

- `golden-path-ecs-template#7`
- `golden-path-ecs-template#28`
- `golden-path-ecs-template#29`
- `golden-path-ecs-template#32`
