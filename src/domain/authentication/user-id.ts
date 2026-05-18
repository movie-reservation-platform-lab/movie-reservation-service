declare const userIdBrand: unique symbol;

/**
 * Branded string for user identities.
 *
 * The brand is compile-time-only TypeScript safety. At runtime a UserId is
 * still a string, so callers must construct it through `createUserId`.
 */
export type UserId = string & {
  readonly [userIdBrand]: 'UserId';
};

/**
 * Normalizes and validates a raw user id string from an external boundary.
 */
export function createUserId(value: string): UserId {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error('UserId cannot be empty');
  }

  return trimmedValue as UserId;
}
