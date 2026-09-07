# Authentication audit demo

`POST /demo/auth/login` checks a throwaway username and password configured for
this demo. It does **not** sign the caller into the reservation application,
create a cookie, or issue a token. This lets us demonstrate real rejected
credentials without changing the existing fixed-user reservation demo.

For every accepted or rejected credential check, the service writes:

```text
HTTP request
  -> validate and compare credentials
  -> build an OCSF Authentication event
  -> stdout: {"audit": <event>}
  -> FireLens / Fluent Bit -> Firehose -> S3 -> Athena
```

Only the first three steps run in this repository. AWS resources, routing,
deployment and teardown instructions belong to
[movie-platform-infra](https://github.com/movie-reservation-platform-lab/movie-platform-infra/issues/43).

## Run locally

Follow the normal [local setup](../DEVELOPMENT.md) and edit the ignored file
`env_files/local/local-fixed-user.env`. Add:

```dotenv
DEMO_AUTH_ENABLED=true
DEMO_AUTH_USERNAME=demo-user
DEMO_AUTH_PASSWORD=replace-with-a-throwaway-password
DEPLOYMENT_ENVIRONMENT=local
```

Choose an actual throwaway password; the value above is only a placeholder.
Do not use credentials from another system. Do not commit the local env file.

```sh
npm run dev
```

From another terminal, send a wrong password:

```sh
curl -i http://127.0.0.1:3000/demo/auth/login \
  -H 'X-Correlation-Id: audit-demo-001' \
  -H 'X-Request-Id: failed-login-001' \
  --json '{"username":"demo-user","password":"intentionally-wrong"}'
```

Expect HTTP 401 and a response such as:

```json
{
  "authenticated": false,
  "message": "Invalid credentials",
  "request_id": "failed-login-001",
  "audit_event_id": "11111111-1111-4111-8111-111111111111"
}
```

The event ID is newly generated, not the example above. A `trace_id` is included
when a valid OpenTelemetry context is active. The terminal shows a raw `audit`
JSON line and a separate `audit.authentication` operational log with the same
event ID. Correct credentials return 200, `authenticated: true`, and a success
audit event. Prefer the browser demo form for that check so the configured
password does not end up in shell history.

Responses use `Cache-Control: no-store`. If the process cannot accept the audit
line locally, the check returns 503 with `authenticated: false`, even when the
credentials matched. This is an unavailable audit output, not a wrong password.

Unset the flag or set `DEMO_AUTH_ENABLED=false` and restart to remove the route
(404). Enabled mode refuses to start without nonblank credentials, and is refused
entirely when `NODE_ENV` is `staging` or `production`. `DEPLOYMENT_ENVIRONMENT`
labels the audit record independently of that safety guard.

## Find the same attempt in each system

| Join key              | Where to find it                                                                  |
| --------------------- | --------------------------------------------------------------------------------- |
| Event ID              | Response `audit_event_id`; event `metadata.uid`; operational log `audit_event_id` |
| Action ID             | `X-Correlation-Id`; event `metadata.correlation_uid`; log `correlation_id`        |
| Request ID            | Response/header; event `unmapped.platform.request_id`; log `request_id`           |
| Active trace/span     | Event `unmapped.platform.trace_id` / `span_id`; log `trace_id` / `span_id`        |
| ALB trace header      | Event `unmapped.platform.aws_alb_trace_id`; log `aws_alb_trace_id`                |
| CloudFront request ID | `aws_cloudfront_request_id`, only if that header actually arrived                 |

Use `metadata.uid` in Athena to select the audit event, then its trace ID in the
trace backend. The ALB header can join to the load balancer's access record when
access logging is enabled. Keep it as a separate field: the ALB identifier is not
necessarily the OpenTelemetry trace identifier.

The active span also carries `audit.event_id`, `audit.outcome`, `app.request_id`,
`app.correlation_id`, and present `aws.alb.trace_id` / `aws.cloudfront.request_id`
attributes. Search by these fields to move from an audit event to its actual span.

The emitter reads the **active** OpenTelemetry span, including valid unsampled
contexts. It does not invent one from an incoming `traceparent`. An unsampled or
failed-to-export trace may have an ID but no stored trace. Audit output does not
depend on sampling or `LOG_LEVEL`. Ingress IDs are correlation hints, not proof
of caller identity; a direct caller can supply them.

## Format and code boundaries

The shared contract and JSON Schema are in [test/fixtures/audit](../test/fixtures/audit/).
They constrain the platform's subset of OCSF 1.3; they are not the complete OCSF
schema. Authentication class `3002`, activity `99` and type `300299` describe a
credential check, not creation of a login session. Failures use the literal
`unknown` user; successes use the literal `demo-user`. Neither is copied from the
submitted username. Failure details come from a fixed allowlist.

- `src/application/audit/`: pure event builder and narrow output/recorder ports.
- `src/infrastructure/audit/`: current request/trace context and raw stdout output.
- `src/application/authentication/demo-login.service.ts`: input checks and result.
- `src/infrastructure/authentication/demo-credential-verifier.ts`: fixed-size
  digest comparisons with `timingSafeEqual`; both username and password are checked.
- `src/presentation/http/demo-auth.controller.ts`: HTTP response only.

Existing GraphQL authentication failures also produce events with
`auth_boundary=graphql`. The local JWT profile still only decodes claims; this
change does not make it a signature-validating production authenticator.

## Limits you should know

A successful stdout write is **not** an S3 or Firehose acknowledgement. FireLens
buffers and retries outside the application; process/task loss can still lose
records. The application bounds pending stdout bytes at 256 KiB and reports
`audit.stdout.failed` if it cannot accept another record or a write fails.
The returned event ID identifies the generated event, not proof of archival.
Known local failures produce demo HTTP 503; existing GraphQL authentication
rejections stay 401. A callback can report a write error after a response was
sent, so even local acceptance cannot guarantee delivery. Node's `write(false)`
means that the line was buffered, not rejected; the adapter does not retry it.

Malformed credential objects get the same generic 401 as wrong credentials.
Syntactically invalid JSON is rejected before the credential check and does not
produce an Authentication event. Submitted usernames, passwords, tokens and
request bodies are never copied into audit fields.

There is no account lockout or production rate limiter here. Keep the demo
behind restricted ingress, use a short-lived password, then disable it.

## Verify changes

```sh
npm run check
npm run build
```

Unit tests check the generated OCSF objects against the shared schema, raw stdout
format and concurrent trace context. HTTP tests cover disabled/malformed/wrong/
successful checks, secret redaction and unchanged GraphQL behavior. Ajv is a
development-only dependency for those schema checks; the emitter has no AWS SDK.
A process-level test starts the real instrumentation bootstrap and verifies that
the span referenced in the audit event reaches a local OTLP collector.

References: [OCSF Authentication 1.3](https://github.com/ocsf/ocsf-schema/blob/1.3.0/events/iam/authentication.json),
[OCSF user identity constraints](https://github.com/ocsf/ocsf-schema/blob/1.3.0/objects/user.json),
[ECS FireLens](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html).
