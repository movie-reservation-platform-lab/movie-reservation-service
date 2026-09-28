import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packPackage } from './pack.mjs';
import { run } from './process.mjs';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
export const packageDirectory = join(scriptsDirectory, '..');

/** @returns {any} */
export function readPackageManifest() {
  return JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
}

/** @param {string} outputDirectory */
export function buildRelease(outputDirectory) {
  const manifest = readPackageManifest();
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  const packDirectory = join(outputDirectory, '.pack');
  mkdirSync(packDirectory);
  const packedPath = packPackage(packageDirectory, packDirectory);
  const artifactName = `audit-sdk-${manifest.version}.tgz`;
  cpSync(packedPath, join(outputDirectory, artifactName));
  rmSync(packDirectory, { recursive: true, force: true });

  cpSync(join(packageDirectory, 'contract'), join(outputDirectory, 'contract'), { recursive: true });
  const sourceRevision = run('git', ['rev-parse', 'HEAD'], { cwd: packageDirectory, capture: true }).trim();
  const sourceStatus = run(
    'git',
    ['status', '--porcelain', '--', '.', '../../package.json', '../../package-lock.json'],
    { cwd: packageDirectory, capture: true },
  ).trim();
  const releaseManifest = {
    bundle_format: 'movie-platform-audit-sdk-release/1',
    package: { name: manifest.name, version: manifest.version, artifact: artifactName },
    contract: { name: 'platform-audit', version: '1', ocsf_version: '1.3.0', directory: 'contract' },
    source: { revision: sourceRevision, dirty: sourceStatus.length > 0 },
  };
  writeFileSync(join(outputDirectory, 'release-manifest.json'), `${stableJson(releaseManifest)}\n`);

  const files = listFiles(outputDirectory).filter((path) => path !== 'SHA256SUMS');
  const checksums = files.map((path) => `${sha256(join(outputDirectory, path))}  ${path}`).join('\n');
  writeFileSync(join(outputDirectory, 'SHA256SUMS'), `${checksums}\n`);
  return { artifactName, files: [...files, 'SHA256SUMS'] };
}

/** @param {string} outputDirectory */
export function verifyRelease(outputDirectory) {
  const checksumPath = join(outputDirectory, 'SHA256SUMS');
  const entries = readFileSync(checksumPath, 'utf8').trim().split('\n');
  if (entries.length === 0) {
    throw new Error('Release checksum manifest is empty');
  }
  /** @type {Map<string, string>} */
  const expectedChecksums = new Map();
  for (const entry of entries) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(entry);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error('Release checksum manifest is malformed');
    }
    const artifactPath = match[2];
    if (isUnsafeManifestPath(artifactPath) || expectedChecksums.has(artifactPath)) {
      throw new Error(`Unsafe or duplicate checksum path: ${artifactPath}`);
    }
    expectedChecksums.set(artifactPath, match[1]);
  }
  const actualPaths = listFiles(outputDirectory).filter((path) => path !== 'SHA256SUMS');
  const expectedPaths = [...expectedChecksums.keys()].sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    throw new Error('Release checksum manifest does not match the release file set');
  }
  for (const [artifactPath, expectedChecksum] of expectedChecksums) {
    if (sha256(join(outputDirectory, artifactPath)) !== expectedChecksum) {
      throw new Error(`Checksum mismatch for ${artifactPath}`);
    }
  }
}

/** @param {string} outputDirectory */
export function hashReleaseTree(outputDirectory) {
  const hash = createHash('sha256');
  for (const path of listFiles(outputDirectory)) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(outputDirectory, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** @param {string} rootDirectory */
function listFiles(rootDirectory) {
  /** @type {string[]} */
  const paths = [];
  visit(rootDirectory);
  return paths.sort();

  /** @param {string} directory */
  function visit(directory) {
    for (const entry of readdirSync(directory).sort()) {
      const absolutePath = join(directory, entry);
      if (statSync(absolutePath).isDirectory()) {
        visit(absolutePath);
      } else {
        paths.push(relative(rootDirectory, absolutePath));
      }
    }
  }
}

/** @param {string} artifactPath */
function isUnsafeManifestPath(artifactPath) {
  return (
    artifactPath.length === 0 ||
    isAbsolute(artifactPath) ||
    artifactPath.includes('\\') ||
    artifactPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

/** @param {string} path */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** @param {any} value @returns {string} */
function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
