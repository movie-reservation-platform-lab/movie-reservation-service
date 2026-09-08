# OCSF authentication demo

## Summary and goals

Add a real, opt-in credential check without changing the existing reservation
demo's authentication profile. Failed checks produce one OCSF Authentication
event on stdout. FireLens routes that event to Firehose; the service does not
call AWS. Infrastructure and the Athena queries live in `movie-platform-infra`.

This is the reservation-service slice of platform issue #43 and service #34.

## Current state

- `config.ts` validates environment variables with Zod. The default
  `local-fixed-user` profile deliberately accepts the fixed demo identity.
- `local-jwt` decodes claims; it does not validate a JWT signature or expiry.
  This change does not turn it into production authentication.
- `GraphqlAuthenticationMiddleware` already rejects missing/malformed bearer
  credentials for profiles that require them.
- Request middleware keeps request, correlation and ALB IDs in AsyncLocalStorage.
  OpenTelemetry owns the active trace. Operational logs use Pino.

## Requirements and assumptions

- `POST /demo/auth/login` is enabled only by `DEMO_AUTH_ENABLED=true` and explicit
  username/password configuration. Missing configuration must fail startup.
- Wrong or missing credentials receive the same 401 response. Correct credentials
  receive 200; this checks credentials only and does not create a session/token.
- Audit events contain no submitted username, password, bearer token or raw body.
- A disabled demo route returns 404. Existing routes keep their current behavior.
- The stdout envelope is `{"audit": <OCSF event>}`. It is a real JSON object,
  not a JSON string nested in an operational-log message.
- AWS ingress identifiers are join hints, not proof of an authenticated caller.

## Design and alternatives

Put the pure event builder and sink port in `src/application/audit/`. The builder
uses only plain TypeScript input. An infrastructure adapter supplies current
request/trace context, event ID and time, then writes one bounded JSON line to
stdout. The demo credential comparator lives in infrastructure and uses fixed-size
hashes with `timingSafeEqual`; the application service never logs credentials.
The HTTP controller validates the body and maps the result to 200/401.

Direct Firehose publishing would give the application an upstream acknowledgement,
but is rejected because the selected platform architecture uses FireLens. Reusing
the existing JWT decoder for a wrong-password demo would not verify credentials,
so the demo gets a deliberately separate endpoint instead.

## Interfaces and data

Add the demo route and optional configuration. Emit OCSF 1.3 Authentication class
3002, activity 99 (other: credential validation), type 300299, with status 1/2.
This does not claim a session was created. Use `metadata.uid` as the event identifier,
`metadata.correlation_uid` as the action join key, and the shared platform
extension for request/trace/AWS identifiers. Missing active spans remain missing;
the emitter must not invent a trace from an arbitrary incoming header.

Ajv is a development-only dependency for validating actual builder output against
the shared platform JSON Schema; it is not added to the runtime emitter.

No database changes, migration, AWS SDK dependency, session, production IdP,
GraphQL schema change or direct AWS resource management.

## Security and reliability

Reject malformed bodies and bound credential lengths before comparison. Disable
demo authentication in staging/production runtime modes. Use generic failure
wording and unknown user identity for failed attempts. Never copy exception text
or untrusted input into audit reason fields.

Audit emission is independent of operational log level and trace sampling. A
successful stdout write is not a Firehose or S3 acknowledgement. Bound local
buffering and report local write/drop failures without exposing the event body.
The stdout adapter returns explicit local acceptance; a known full buffer or
synchronous write failure makes the demo return a redacted 503, including when
credentials matched. GraphQL rejection remains 401 if audit output fails. A write
callback can report an error after the response; that remains a logged delivery
failure, not a retroactive HTTP result. Annotate the actual span with sanitized
event/request/action/AWS IDs, and send demo results with `Cache-Control: no-store`.
Routing retry/buffering,
retention and recovery are infrastructure responsibilities.

## Implementation order

1. Add the pure OCSF builder, typed sink, and unit tests under
   `src/application/audit/` and `test/unit/application/`.
2. Add stdout and request-context adapters under `src/infrastructure/audit/`;
   test raw line format, active span selection, sanitization and write failures.
3. Extend configuration, add a plain demo-login service, and wire a small HTTP
   module/controller. Test valid, wrong, missing, malformed and disabled requests.
4. Emit on existing GraphQL authentication rejection, preserving the response.
5. Write local request examples and describe the shared output contract.
6. Run the narrow tests, `npm run check`, and `npm run build`; review the diff for
   secrets and unrelated edits before an `[ai]` commit and PR.

## Testing and done criteria

- Pure builder fixtures cover required OCSF values, stable IDs, omitted absent
  trace data and secret-free fields.
- Adapter tests cover real active context, concurrent requests, disabled tracing,
  newline-safe serialization and local output failures.
- HTTP tests cover success, wrong credentials, malformed body and 404 when off.
- Existing GraphQL/local-fixed-user tests still pass.
- Shared cross-repository fixture fields match the infrastructure parser.
- Docs explain what the endpoint does and does not authenticate.

## Rollout, rollback and risks

Deploy the new image with the flag off first. Enable only on the restricted demo
ingress with a throwaway secret. Check raw stdout locally and Athena after the
infrastructure rollout. Disable the flag or roll back to the previous image to
remove the route; existing archived records need no migration.

| Risk                                           | Mitigation                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Mistaking the demo check for application login | No session/token, explicit docs and isolated route                 |
| Password/username leakage                      | Fixed audit reason codes, unknown failed identity, no body logging |
| Runtime log wrapping breaks routing            | Adapter serialization contract tests                               |
| Spoofed ingress IDs                            | Bounded fields, correlation-only semantics                         |
| Collector outage loses audit lines             | Explicit stdout guarantee; infrastructure buffers/retries          |

## Review checklist

- [x] Existing auth and observability boundaries inspected
- [x] Alternatives, security and rollback considered
- [x] Implementation ordered with named modules and checks
- [x] Contract, HTTP and trace-export tests pass
- [x] Diff reviewed; unrelated guidance files excluded

Verification covers 116 unit tests and 19 demo HTTP cases, including local output
failure returning 503 and unchanged GraphQL rejection. A real-process integration
test proves that the event's span reaches a local OTLP collector with the matching
audit, request, action and AWS attributes. Run `npm run ci` from a clean checkout
for formatting, lint, typechecks, automation, integration, database e2e and build.

## Handoff

Implement this plan on the service issue branch. Preserve unrelated guidance
edits. Do not deploy AWS resources or change other repositories. Every commit
subject and PR title must start with `[ai]`.
