import servicePackage from '../package.json';

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`movie-reservation-service/package.json must define a non-empty ${fieldName}`);
  }

  return value;
}

/** Service identity comes from the workspace package metadata, not deployment code. */
export const SERVICE_NAME = requireNonEmptyString(servicePackage.name, 'name');
export const SERVICE_VERSION = requireNonEmptyString(servicePackage.version, 'version');
