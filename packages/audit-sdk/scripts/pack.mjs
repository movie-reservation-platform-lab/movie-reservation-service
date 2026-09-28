import { basename, join } from 'node:path';

import { run } from './process.mjs';

/** @param {string} packageDirectory @param {string} destination */
export function packPackage(packageDirectory, destination) {
  const output = run('npm', ['pack', '--json', '--pack-destination', destination], {
    cwd: packageDirectory,
    capture: true,
  });
  const result = JSON.parse(output);
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.filename !== 'string') {
    throw new Error('npm pack returned an unexpected result');
  }
  return join(destination, basename(result[0].filename));
}
