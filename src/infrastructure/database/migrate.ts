import knexFactory from 'knex';

import { config } from '../../config';
import {
  createKnexConfig,
  createPostgresConnectionSettings,
} from './knex-config';

type MigrationCommand = 'latest' | 'status';

export async function runMigrationCommand(
  command: MigrationCommand,
): Promise<void> {
  const database = knexFactory(
    createKnexConfig(createPostgresConnectionSettings(config)),
  );

  try {
    if (command === 'latest') {
      const latestMigrationResult: unknown = await database.migrate.latest();
      const latestResult = readLatestMigrationResult(latestMigrationResult);
      console.log(
        `Database migrations complete: batch=${latestResult.batchNumber} applied=${latestResult.migrationNames.length}`,
      );
      return;
    }

    const migrationStatusResult: unknown = await database.migrate.list();
    const statusResult = readMigrationStatusResult(migrationStatusResult);
    console.log(
      `Database migration status: completed=${statusResult.completed.length} pending=${statusResult.pending.length}`,
    );
    for (const migration of statusResult.pending) {
      console.log(`pending ${migration.name}`);
    }
  } finally {
    await database.destroy();
  }
}

interface MigrationStatusItem {
  readonly name: string;
}

function readLatestMigrationResult(value: unknown): {
  readonly batchNumber: number;
  readonly migrationNames: readonly string[];
} {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('Unexpected Knex migration result');
  }

  const batchNumber: unknown = value[0];
  const migrationNames: unknown = value[1];

  if (typeof batchNumber !== 'number' || !isStringArray(migrationNames)) {
    throw new Error('Unexpected Knex migration result');
  }

  return { batchNumber, migrationNames };
}

function readMigrationStatusResult(value: unknown): {
  readonly completed: readonly MigrationStatusItem[];
  readonly pending: readonly MigrationStatusItem[];
} {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('Unexpected Knex migration status result');
  }

  return {
    completed: readMigrationStatusItems(value[0]),
    pending: readMigrationStatusItems(value[1]),
  };
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === 'string')
  );
}

function readMigrationStatusItems(
  value: unknown,
): readonly MigrationStatusItem[] {
  if (!Array.isArray(value)) {
    throw new Error('Unexpected Knex migration status result');
  }

  return value.map((item): MigrationStatusItem => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('Unexpected Knex migration status result');
    }

    const migration = item as {
      readonly file?: unknown;
      readonly name?: unknown;
    };
    const name = migration.name ?? migration.file;

    if (typeof name !== 'string') {
      throw new Error('Unexpected Knex migration status result');
    }

    return { name };
  });
}

function readCommand(args: readonly string[]): MigrationCommand {
  const command = args[0] ?? 'latest';

  if (command === 'latest' || command === 'status') {
    return command;
  }

  throw new Error(`Unsupported migration command: ${command}`);
}

if (require.main === module) {
  void runMigrationCommand(readCommand(process.argv.slice(2))).catch(
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
