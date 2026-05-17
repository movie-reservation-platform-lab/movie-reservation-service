import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findServiceRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;

  while (!existsSync(join(currentDirectory, 'package.json'))) {
    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error('Could not find service package root');
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

const serviceRoot = findServiceRoot(__dirname);

// TODO: Move schema publishing into a CI artifact step once the API contract
//  needs to be shared outside local troubleshooting.
export const generatedGraphqlSchemaPath = join(serviceRoot, 'schema.gql');
