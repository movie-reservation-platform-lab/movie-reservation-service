# Reservation service observability

This service emits OTLP metrics and traces through the standard OpenTelemetry
environment configuration and writes structured JSON logs to stdout. The local
contract test in
`test/integration/observability/service-signal-contract.test.ts` captures the
SDK payload before any collector transformation.

## Emitted metric contract

All metrics use the `movie-reservation-service` meter and cumulative
temporality. Resource identity is supplied by the runtime and must include
`service.name`, `service.version`, and `deployment.environment.name`.

| Instrument                               | Type          | Unit                                                       | Bounded attributes                                                          |
| ---------------------------------------- | ------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `http_request_total`                     | monotonic sum | `{request}` (exported as an empty OTLP unit by the JS SDK) | `http_method`, `http_route`, `http_status_code`, `status_family`, `outcome` |
| `http_request_duration_ms`               | histogram     | `ms`                                                       | same as HTTP counter                                                        |
| `graphql_operation_total`                | monotonic sum | `{operation}` (empty OTLP unit)                            | `business_operation`, `graphql_operation_type`, `outcome`                   |
| `graphql_operation_duration_ms`          | histogram     | `ms`                                                       | same as GraphQL counter                                                     |
| `graphql_operation_exceptions_total`     | monotonic sum | `{exception}` (empty OTLP unit)                            | `business_operation`, `exception_type`                                      |
| `reservation_request_created_total`      | monotonic sum | `{request}` (empty OTLP unit)                              | `business_operation`                                                        |
| `reservation_processor_claim_total`      | monotonic sum | `{request}` (empty OTLP unit)                              | none                                                                        |
| `reservation_processor_outcome_total`    | monotonic sum | `{attempt}` (empty OTLP unit)                              | `outcome`                                                                   |
| `reservation_processor_duration_ms`      | histogram     | `ms`                                                       | `outcome`                                                                   |
| `reservation_processor_exceptions_total` | monotonic sum | `{exception}` (empty OTLP unit)                            | `exception_type`                                                            |

HTTP routes are allowlisted as `/graphql`, `/demo/auth/login`, `/health`, and
`/ready`; unknown paths collapse to `unmatched`. `/health` and `/ready` are
excluded from both HTTP metric families. HTTP outcomes are `success`,
`client_error`, and `server_error`. GraphQL errors are recorded independently
of the HTTP status, so a business failure returned through HTTP 200 increments
`graphql_operation_total{outcome="graphql_error"}`.

GraphQL counter series and reservation processor outcome series are initialized
with real zero-valued sums for their bounded combinations. Histograms never
receive synthetic zero-duration observations. HTTP counters appear only after
eligible traffic. Therefore:

- a present zero on a pre-initialized error series means no observed errors;
- an absent HTTP series may mean idle, not yet started, or broken export;
- a zero denominator is unknown/idle and must not be rendered as healthy;
- freshness must be checked separately before alerts interpret a value.

Prometheus names and labels are collector outputs, not producer facts. Confirm
the collector translation before committing dashboard or alert queries.

## Trace and log correlation

Incoming W3C `traceparent`/`tracestate` is persisted with reservation work. The
worker extracts that context and starts `reservation_request.process` as a
consumer child. Worker failures mark the span as error and never emit a success
outcome. Structured logs include the active `trace_id` and `span_id`, plus the
bounded event name and available request/correlation IDs. They do not put those
identifiers, user IDs, raw URLs, GraphQL documents, or exception messages into
metric attributes.

Useful log events include `graphql.operation.failure`,
`reservation_processor.exception`, `reservation_request.confirmed`, and
`reservation_request.processing_retry_scheduled`.

## Query intent

Collector translation determines the final AMP names. After that translation is
verified, dashboards should calculate:

- HTTP error percentage from eligible 4xx/5xx outcomes divided by eligible HTTP
  requests, guarded by a positive denominator and freshness check;
- GraphQL business error percentage from `graphql_error`, `auth_error`, and
  `unexpected_error` outcomes, even though the transport may report 200;
- worker failure percentage from `retryable-failure` and `failed` divided by
  non-empty processor outcomes;
- latency from the exported histogram buckets, grouped only by bounded route,
  operation, or outcome dimensions.

## Known limits

Node process CPU and memory telemetry describes this service process. ECS
Container Insights describes the shared task and cannot attribute CPU or memory
to this container when all backends share one task. No browser telemetry, queue
depth gauge, or durable external worker signal is emitted. Queryable evidence in
AMP, CloudWatch, X-Ray, or Tempo remains a deployment-stage check owned outside
this repository.
