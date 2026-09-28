import { join } from 'node:path';

import { buildRelease, packageDirectory, readPackageManifest, verifyRelease } from './release-lib.mjs';

const manifest = readPackageManifest();
const outputDirectory = join(packageDirectory, 'release', manifest.version);
const result = buildRelease(outputDirectory);
verifyRelease(outputDirectory);
process.stdout.write(`Built ${result.artifactName} and verified ${result.files.length} release files.\n`);
