# Movie Reservation Service

NestJS GraphQL API for the movie reservation platform.

This repository was extracted from
`movie-reservation-platform-lab/golden-path-ecs-template` so the reservation API
can have an independent CI and artifact pipeline. Keep the golden-path copy as
the migration source until this repository passes CI and an AWS smoke check.

## Local Development

```sh
npm ci
mkdir -p env_files/local
cp env_files/templates/local/local-fixed-user.env.template env_files/local/local-fixed-user.env
npm run dev
```

Useful scripts:

- `npm run check` runs formatting, lint, typecheck, unit tests, and integration tests.
- `npm run ci` runs the full repository CI check, including e2e tests and build.
- `npm run build` compiles the service into `dist/`.
- `npm run db:migrate:local-postgres` applies local Postgres migrations.

## Deployment Contract

Application CI should publish an immutable container image. Platform
infrastructure consumes that image by digest from the environment manifest; this
repository does not deploy shared AWS infrastructure directly.

## Source Backlog

Initial extraction work is derived from:

- `golden-path-ecs-template#7`
- `golden-path-ecs-template#28`
- `golden-path-ecs-template#29`
- `golden-path-ecs-template#32`
