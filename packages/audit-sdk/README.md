# Audit SDK

This package owns the Movie Reservation Platform Lab's constrained OCSF 1.3
Authentication event contract. It is incubated here for later extraction and
has no dependency on reservation-service source modules.

Use explicit public subpaths:

```ts
import { buildAuthenticationAuditEvent } from '@movie-reservation-platform-lab/audit-sdk/core';
import { EventBridgeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/eventbridge';
import { FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';
```

`AuditPublisher.publish` reports transport acceptance only. EventBridge
acceptance does not prove that a downstream archive or Security Lake stored the
event. The adapter accepts an exact event-bus ARN, owns its source/detail-type
constants, and exposes bounded failure reasons without AWS exception details.

The package ships ES modules and requires Node.js 24 or later. Its `default`
export condition lets CommonJS consumers on Node 24 `require()` the same ESM
files (Node's `require(esm)`; the package has no top-level await). The packed
consumer test covers both module systems. Older runtimes and bundlers that
cannot load ESM through `require()` are not supported.

The contract files are packaged under explicit `contract/*` exports. The v1
schema is closed: unknown fields are rejected, so any emitted wire-field change
requires a new contract version and a side-by-side migration.

The EventBridge adapter accepts timeout values from 1 through 30,000 ms and up
to five resource ARNs. Configuration errors expose only the invalid field name.

Prefer `createEventBridgeAuditPublisher({ eventBusArn, timeoutMs })`: it builds
the AWS client with one attempt per publish (retrying belongs to a durable
relay, not a request waiting on audit) and the Region taken from the bus ARN,
using the default credential and endpoint chain. Consumers then never import or
pin `@aws-sdk/*` themselves. Construct it once per process.

## Commands

```sh
npm run build
npm test
npm run test:consumer
npm run release
npm run verify:release
```

`release` writes ignored local review artifacts under `release/<version>/`.
Nothing in this package publishes externally or calls a live AWS endpoint.
