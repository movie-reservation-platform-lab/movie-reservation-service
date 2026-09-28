import { readFileSync } from 'node:fs';

import { assertValidAuthenticationAuditEvent, type AuthenticationAuditEvent } from '../core/index.js';

export const canonicalAcceptedAuthenticationEvent = readCanonicalEvent(
  '../../contract/examples/authentication-accepted-v1.json',
);
export const canonicalRejectedAuthenticationEvent = readCanonicalEvent(
  '../../contract/examples/authentication-rejected-v1.json',
);

function readCanonicalEvent(relativePath: string): AuthenticationAuditEvent {
  const value: unknown = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  assertValidAuthenticationAuditEvent(value);
  return deepFreeze(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
