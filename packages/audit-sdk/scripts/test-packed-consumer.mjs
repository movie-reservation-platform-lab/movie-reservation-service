import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packPackage } from './pack.mjs';
import { packageDirectory } from './release-lib.mjs';
import { run } from './process.mjs';

const esmConsumerSource = `import { validateAuthenticationAuditEvent } from '@movie-reservation-platform-lab/audit-sdk/core';
import { AUDIT_EVENTBRIDGE_SOURCE, createEventBridgeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/eventbridge';
import { canonicalRejectedAuthenticationEvent, FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';

const validation = validateAuthenticationAuditEvent(canonicalRejectedAuthenticationEvent);
if (!validation.valid || AUDIT_EVENTBRIDGE_SOURCE.length === 0) throw new Error('public contract import failed');
// Constructs the AWS client without a network call.
createEventBridgeAuditPublisher({ eventBusArn: 'arn:aws:events:eu-central-1:123456789012:event-bus/consumer-check', timeoutMs: 1000 });
const result = await new FakeAuditPublisher().publish(canonicalRejectedAuthenticationEvent);
if (!result.accepted) throw new Error('public testing import failed');
`;

// CommonJS consumers load the ESM build through Node 24 require(esm); TypeScript emits require() calls here.
const commonJsConsumerSource = `import { validateAuthenticationAuditEvent } from '@movie-reservation-platform-lab/audit-sdk/core';
import { AUDIT_EVENTBRIDGE_SOURCE, createEventBridgeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/eventbridge';
import { canonicalRejectedAuthenticationEvent, FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';

if (typeof require !== 'function') throw new Error('consumer was not compiled as CommonJS');
const validation = validateAuthenticationAuditEvent(canonicalRejectedAuthenticationEvent);
if (!validation.valid || AUDIT_EVENTBRIDGE_SOURCE.length === 0) throw new Error('public contract import failed');
// Constructs the AWS client without a network call.
createEventBridgeAuditPublisher({ eventBusArn: 'arn:aws:events:eu-central-1:123456789012:event-bus/consumer-check', timeoutMs: 1000 });
void new FakeAuditPublisher().publish(canonicalRejectedAuthenticationEvent).then((result) => {
  if (!result.accepted) throw new Error('public testing import failed');
});
`;

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'audit-sdk-consumer-'));
try {
  const packDirectory = join(temporaryDirectory, 'pack');
  mkdirSync(packDirectory);
  const tarball = packPackage(packageDirectory, packDirectory);
  verifyConsumer(join(temporaryDirectory, 'esm-consumer'), tarball, 'module', esmConsumerSource);
  verifyConsumer(join(temporaryDirectory, 'commonjs-consumer'), tarball, 'commonjs', commonJsConsumerSource);
  process.stdout.write('Packed tarball ESM and CommonJS consumers compiled and ran every public TypeScript subpath.\n');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

/**
 * @param {string} consumerDirectory
 * @param {string} tarball
 * @param {'module' | 'commonjs'} moduleType
 * @param {string} source
 */
function verifyConsumer(consumerDirectory, tarball, moduleType, source) {
  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: `audit-sdk-packed-${moduleType}-consumer`,
        private: true,
        type: moduleType,
        dependencies: { '@movie-reservation-platform-lab/audit-sdk': `file:${tarball}` },
        devDependencies: { '@types/node': '25.5.0', typescript: '5.9.3' },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          strict: true,
          outDir: 'dist',
          skipLibCheck: true,
          types: ['node'],
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(consumerDirectory, 'consumer.ts'), source);
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumerDirectory });
  run('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: consumerDirectory });
  run('node', ['--throw-deprecation', '--trace-warnings', 'dist/consumer.js'], { cwd: consumerDirectory });

  const packedManifest = JSON.parse(
    readFileSync(
      join(consumerDirectory, 'node_modules', '@movie-reservation-platform-lab', 'audit-sdk', 'package.json'),
      'utf8',
    ),
  );
  if (packedManifest.name !== '@movie-reservation-platform-lab/audit-sdk') {
    throw new Error(`packed ${moduleType} consumer installed an unexpected package`);
  }
}
