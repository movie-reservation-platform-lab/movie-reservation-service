import { spawnSync } from 'node:child_process';

/**
 * @param {string} command
 * @param {string[]} arguments_
 * @param {Omit<import('node:child_process').SpawnSyncOptionsWithStringEncoding, 'encoding' | 'stdio'> & {capture?: boolean}} [options]
 */
export function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8',
    stdio: options.capture === true ? 'pipe' : 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    const detail = options.capture === true ? `${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    throw new Error(`${command} ${arguments_.join(' ')} failed${detail.length === 0 ? '' : `\n${detail}`}`);
  }
  return result.stdout ?? '';
}
