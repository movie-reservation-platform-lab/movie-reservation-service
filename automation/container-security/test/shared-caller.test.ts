import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const pin = '388507380ae9bc2b1ac91282ff16f40d4c65fcfc';
let temporary = '';

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'reservation-shared-caller-'));
  mkdirSync(join(temporary, 'tooling'));
  mkdirSync(join(temporary, 'bin'));
  executable('git', `if [[ "$3" == rev-parse ]]; then echo "$TEST_REVISION"; else printf '%s' "$TEST_CHANGES"; fi`);
  executable('docker', 'printf "%s\\n" "$PWD" "$@" > "$TEST_BUILD_LOG"; exit "${TEST_BUILD_STATUS:-0}"');
  executable('node', 'printf "%s\\n" "$@" > "$TEST_SCAN_LOG"; exit "${TEST_SCAN_STATUS:-0}"');
});

afterEach(() => rmSync(temporary, { recursive: true, force: true }));

function executable(name: string, body: string): void {
  const path = join(temporary, 'bin', name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(overrides: Readonly<Record<string, string>> = {}) {
  return spawnSync('bash', [join(root, 'automation/container-security/src/check.sh')], {
    cwd: temporary,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(temporary, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      PLATFORM_ACTIONS_DIRECTORY: join(temporary, 'tooling'),
      GH_TOKEN: 'test-only',
      TEST_REVISION: pin,
      TEST_CHANGES: '',
      TEST_BUILD_LOG: join(temporary, 'build.log'),
      TEST_SCAN_LOG: join(temporary, 'scan.log'),
      ...overrides,
    },
  });
}

describe('shared production-image caller', () => {
  it('builds the exact production target from the repository root and delegates v3 policy', () => {
    expect(run().status).toBe(0);
    expect(readFileSync(join(temporary, 'build.log'), 'utf8').trim().split('\n')).toEqual([
      root,
      'build',
      '--platform',
      'linux/amd64',
      '--target',
      'runtime',
      '--tag',
      'movie-reservation-service:local',
      '.',
    ]);
    expect(readFileSync(join(temporary, 'scan.log'), 'utf8').trim().split('\n')).toEqual([
      join(temporary, 'tooling/local-tools/container-security/lib/scan.mjs'),
      'movie-reservation-service:local',
      '--evidence-version',
      'v1alpha3',
      '--component',
      'reservation-service',
      '--output-dir',
      join(root, 'security-evidence/local'),
    ]);
    expect(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).toContain(`ref: ${pin}`);
  });

  it.each([{ TEST_REVISION: '0'.repeat(40) }, { TEST_CHANGES: ' M modified-tool.mjs' }, { GH_TOKEN: '' }])(
    'rejects invalid tooling or missing authentication before building: %j',
    (overrides) => {
      expect(run(overrides).status).not.toBe(0);
      expect(existsSync(join(temporary, 'build.log'))).toBe(false);
      expect(existsSync(join(temporary, 'scan.log'))).toBe(false);
    },
  );

  it('does not scan after a failed build', () => {
    expect(run({ TEST_BUILD_STATUS: '9' }).status).toBe(9);
    expect(existsSync(join(temporary, 'scan.log'))).toBe(false);
  });

  it('propagates shared scanner or policy failure without a legacy fallback', () => {
    expect(run({ TEST_SCAN_STATUS: '7' }).status).toBe(7);
  });
});
