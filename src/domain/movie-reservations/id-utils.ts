/**
 * Creates a branded domain id from a non-empty string.
 *
 * The brand is compile-time only, so this helper is the runtime guard that
 * prevents empty ids from entering the domain model.
 */
export function createNonEmptyId<TId extends string>(
  value: string,
  typeName: string,
): TId {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${typeName} cannot be empty`);
  }

  return trimmedValue as TId;
}
