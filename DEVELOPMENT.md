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

That command uses `env_files/local-fixed-user.env`. To select a different
local DI profile, run one of the named scripts:

```bash
npm -w movie-reservation-service run dev:local-fixed-user
npm -w movie-reservation-service run dev:local-jwt
```

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

The committed env profiles are intentionally non-secret:

- `env_files/local-fixed-user.env` for fast local development.
- `env_files/local-jwt.env` for local bearer-token claim testing.
- `env_files/test.env` for test defaults.
- `env_files/production-oidc.env.example` as a placeholder for future
  production OIDC wiring.

Copyable templates live under `env_files/templates/`. Use those when a
profile needs local-only values or future secret-backed settings. Rendered local
files should use names such as `env_files/local-jwt.local.env`; those are
ignored by git.

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
- `vitest run` for behavior tests.

Run the full CI-style command, including the production build:

```bash
npm -w movie-reservation-service run ci
```

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
