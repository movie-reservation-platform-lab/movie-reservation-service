export const REDACTED_AUDIT_VALUE = '[REDACTED]' as const;

export interface AuditRedactionOptions {
  readonly sensitiveValues?: readonly string[];
  readonly maxDepth?: number;
}

const sensitiveKey =
  /(?:authorization|cookie|credential|password|passphrase|secret|token|api[-_]?key|private[-_]?key)/i;
const credentialPattern = /\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/giu;

/**
 * Produces a detached diagnostic-safe value. Audit event construction remains
 * allowlist-based; this helper is defense in depth for adapter diagnostics and
 * test tooling that must handle unknown values.
 */
export function redactSensitiveValues(value: unknown, options: AuditRedactionOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 8;
  const replacements = (options.sensitiveValues ?? []).filter((item) => item.length > 0);
  const visited = new WeakSet<object>();

  function redact(current: unknown, depth: number): unknown {
    if (typeof current === 'string') {
      let redacted = current.replaceAll(credentialPattern, REDACTED_AUDIT_VALUE);
      for (const replacement of replacements) {
        redacted = redacted.replaceAll(replacement, REDACTED_AUDIT_VALUE);
      }
      return redacted;
    }
    if (current === null || typeof current !== 'object') {
      return current;
    }
    if (depth >= maxDepth || visited.has(current)) {
      return REDACTED_AUDIT_VALUE;
    }
    visited.add(current);
    if (Array.isArray(current)) {
      return current.map((item) => redact(item, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(current).map(([key, nestedValue]) => [
        key,
        sensitiveKey.test(key) ? REDACTED_AUDIT_VALUE : redact(nestedValue, depth + 1),
      ]),
    );
  }

  return redact(value, 0);
}
