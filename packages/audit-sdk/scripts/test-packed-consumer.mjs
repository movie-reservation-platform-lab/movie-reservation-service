import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packPackage } from './pack.mjs';
import { packageDirectory } from './release-lib.mjs';
import { run } from './process.mjs';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'audit-sdk-consumer-'));
try {
  const packDirectory = join(temporaryDirectory, 'pack');
  const consumerDirectory = join(temporaryDirectory, 'consumer');
  mkdirSync(packDirectory);
  mkdirSync(consumerDirectory);
  const tarball = packPackage(packageDirectory, packDirectory);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'audit-sdk-packed-consumer',
        private: true,
        type: 'module',
        dependencies: { '@movie-reservation-platform-lab/audit-sdk': `file:${tarball}` },
        devDependencies: { typescript: '5.9.3' },
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
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerDirectory, 'consumer.ts'),
    `import { validateAuthenticationAuditEvent } from '@movie-reservation-platform-lab/audit-sdk/core';
import { AUDIT_EVENTBRIDGE_SOURCE } from '@movie-reservation-platform-lab/audit-sdk/eventbridge';
import { canonicalRejectedAuthenticationEvent, FakeAuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/testing';

const validation = validateAuthenticationAuditEvent(canonicalRejectedAuthenticationEvent);
if (!validation.valid || AUDIT_EVENTBRIDGE_SOURCE.length === 0) throw new Error('public contract import failed');
const result = await new FakeAuditPublisher().publish(canonicalRejectedAuthenticationEvent);
if (!result.accepted) throw new Error('public testing import failed');
`,
  );
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumerDirectory });
  run('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: consumerDirectory });
  run('node', ['dist/consumer.js'], { cwd: consumerDirectory });

  const packedManifest = JSON.parse(
    readFileSync(
      join(consumerDirectory, 'node_modules', '@movie-reservation-platform-lab', 'audit-sdk', 'package.json'),
      'utf8',
    ),
  );
  if (packedManifest.name !== '@movie-reservation-platform-lab/audit-sdk') {
    throw new Error('packed consumer installed an unexpected package');
  }
  process.stdout.write('Packed tarball consumer compiled and ran every public TypeScript subpath.\n');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
