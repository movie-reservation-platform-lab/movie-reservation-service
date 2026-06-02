/**
 * Creates a branded domain id from a non-empty string.
 *
 * The brand is compile-time only, so this helper is the runtime guard that
 * prevents empty ids from entering the domain model.
 */
export function createNonEmptyId<TId extends string>(value: string, typeName: string): TId {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${typeName} cannot be empty`);
  }

  return trimmedValue as TId;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Creates a branded service-owned id from a UUID string.
 *
 * The brand gives compile-time TypeScript separation between ids. The UUID
 * check is the runtime guard that keeps externally supplied GraphQL/auth ids
 * aligned with the database primary key shape.
 */
export function createUuidId<TId extends string>(value: string, typeName: string): TId {
  const trimmedValue = value.trim();

  if (!uuidPattern.test(trimmedValue)) {
    throw new Error(`${typeName} must be a UUID`);
  }

  return trimmedValue.toLowerCase() as TId;
}
