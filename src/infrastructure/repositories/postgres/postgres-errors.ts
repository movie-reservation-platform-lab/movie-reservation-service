interface PostgresErrorLike {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

/**
 * Checks whether an unknown database error is a Postgres unique violation.
 *
 * Postgres reports unique constraint failures with SQLSTATE `23505`. Supplying a
 * constraint name narrows the match to one specific database invariant.
 */
export function isPostgresUniqueViolation(error: unknown, constraintName?: string): boolean {
  if (!isPostgresErrorLike(error) || error.code !== '23505') {
    return false;
  }

  if (constraintName === undefined) {
    return true;
  }

  return error.constraint === constraintName;
}

/**
 * Narrows caught `unknown` errors enough to inspect common Postgres fields.
 */
function isPostgresErrorLike(error: unknown): error is PostgresErrorLike {
  return typeof error === 'object' && error !== null;
}
