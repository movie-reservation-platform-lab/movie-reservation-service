/**
 * Extracts the bearer credential from a GraphQL HTTP request header.
 *
 * This helper is deliberately limited to transport parsing. It does not parse
 * or validate the JWT itself; authentication remains owned by the application
 * authentication boundary.
 *
 * TODO: Move this into a shared auth library and make the parser fully
 *  standards-aware, including case-insensitive auth schemes and malformed
 *  multi-value authorization headers.
 *
 */
export function extractBearerToken(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): string | undefined {
  const authorization = readHeader(headers, 'authorization');

  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || token === undefined || token.trim().length === 0) {
    return undefined;
  }

  return token;
}

function readHeader(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  return value[0];
}
