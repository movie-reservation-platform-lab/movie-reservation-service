import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  componentCandidateEvidenceJsonSchemaPath,
  serializeComponentCandidateEvidenceJsonSchema,
} from './candidate-evidence-contract.js';

async function main(): Promise<void> {
  mkdirSync(dirname(componentCandidateEvidenceJsonSchemaPath), { recursive: true });
  writeFileSync(
    componentCandidateEvidenceJsonSchemaPath,
    await serializeComponentCandidateEvidenceJsonSchema(),
    'utf8',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
