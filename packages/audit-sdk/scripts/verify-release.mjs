import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRelease, hashReleaseTree, packageDirectory, verifyRelease } from './release-lib.mjs';
import { run } from './process.mjs';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'audit-sdk-release-'));
try {
  const first = join(temporaryDirectory, 'first');
  const second = join(temporaryDirectory, 'second');
  cleanBuild();
  buildRelease(first);
  cleanBuild();
  buildRelease(second);
  verifyRelease(first);
  verifyRelease(second);
  const firstHash = hashReleaseTree(first);
  const secondHash = hashReleaseTree(second);
  if (firstHash !== secondHash) {
    throw new Error('Release bundle is not reproducible across clean builds');
  }
  verifyTamperingIsDetected(first);
  process.stdout.write(`Verified reproducible release bundle ${firstHash}.\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function cleanBuild() {
  rmSync(join(packageDirectory, 'dist'), { recursive: true, force: true });
  run('npm', ['run', 'build'], { cwd: packageDirectory });
}

/** @param {string} releaseDirectory */
function verifyTamperingIsDetected(releaseDirectory) {
  const checksumPath = join(releaseDirectory, 'SHA256SUMS');
  const originalChecksums = readFileSync(checksumPath, 'utf8');

  writeFileSync(join(releaseDirectory, 'unexpected.txt'), 'unexpected\n');
  expectVerificationFailure(releaseDirectory, 'an unlisted release file');
  rmSync(join(releaseDirectory, 'unexpected.txt'));

  const [firstLine, ...remainingLines] = originalChecksums.trimEnd().split('\n');
  if (firstLine === undefined || remainingLines.length === 0) {
    throw new Error('Expected multiple release artifacts in SHA256SUMS');
  }
  writeFileSync(checksumPath, `${remainingLines.join('\n')}\n`);
  expectVerificationFailure(releaseDirectory, 'a missing checksum entry');
  writeFileSync(checksumPath, originalChecksums);

  const artifactPath = firstLine.replace(/^[0-9a-f]{64} {2}/, '');
  writeFileSync(join(releaseDirectory, artifactPath), 'tampered\n');
  expectVerificationFailure(releaseDirectory, 'tampered artifact content');
}

/** @param {string} releaseDirectory @param {string} scenario */
function expectVerificationFailure(releaseDirectory, scenario) {
  try {
    verifyRelease(releaseDirectory);
  } catch {
    return;
  }
  throw new Error(`Release verification accepted ${scenario}`);
}
