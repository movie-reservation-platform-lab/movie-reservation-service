// Runs inside the built image (`docker run -i <image> - < this-file`) to prove the
// workspace audit SDK, its runtime dependencies and its bundled JSON Schema shipped,
// and that the compiled CommonJS service can load and use it.
'use strict';

const { Writable } = require('node:stream');

const { validateAuthenticationAuditEvent } = require('@movie-reservation-platform-lab/audit-sdk/core');
const { AUDIT_EVENTBRIDGE_SOURCE } = require('@movie-reservation-platform-lab/audit-sdk/eventbridge');
const {
  RequestAuthenticationAuditRecorder,
} = require('./dist/src/infrastructure/audit/request-authentication-audit-recorder.js');
const { StdoutAuditPublisher } = require('./dist/src/infrastructure/audit/stdout-audit-publisher.js');

async function main() {
  const lines = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const publisher = new StdoutAuditPublisher(output, (reason) => {
    throw new Error(`stdout publisher failed: ${reason}`);
  });
  const silentLogger = { info() {}, error() {} };
  const recorder = new RequestAuthenticationAuditRecorder(
    { serviceName: 'movie-reservation-service', serviceVersion: 'image-smoke', environment: 'image-smoke' },
    publisher,
    silentLogger,
  );

  // The SDK builder validates against contract/platform-audit-event-v1.schema.json, read from disk.
  const receipt = await recorder.record({
    outcome: { authenticated: false, reason: 'INVALID_CREDENTIALS' },
    route: '/demo/auth/login',
    authBoundary: 'demo_login',
  });
  const event = JSON.parse(lines.join('')).audit;
  if (
    event.metadata.uid !== receipt.audit_event_id ||
    !validateAuthenticationAuditEvent(event).valid ||
    AUDIT_EVENTBRIDGE_SOURCE.length === 0
  ) {
    throw new Error('audit SDK loaded but the service did not publish a valid event');
  }
  process.stdout.write('Audit SDK image smoke passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
