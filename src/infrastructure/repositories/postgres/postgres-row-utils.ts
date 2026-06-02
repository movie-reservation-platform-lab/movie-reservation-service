export function requireSingleRow<TRow>(rows: readonly TRow[], errorMessage: string): TRow {
  const row = rows[0];

  if (row === undefined) {
    throw new Error(errorMessage);
  }

  return row;
}
