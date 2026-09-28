import { readFileSync } from 'node:fs';

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

import type { AuthenticationAuditEvent } from './authentication-audit-event.js';

export const MAX_AUDIT_EVENT_BYTES = 240 * 1024;

export type AuditValidationIssueCode =
  | 'invalid_contract'
  | 'invalid_enum'
  | 'invalid_format'
  | 'invalid_timestamp'
  | 'invalid_version'
  | 'missing_field'
  | 'forbidden_field'
  | 'size_exceeded';

export interface AuditValidationIssue {
  readonly code: AuditValidationIssueCode;
  readonly path: string;
}

export type AuditValidationResult =
  | { readonly valid: true; readonly event: AuthenticationAuditEvent; readonly byteLength: number }
  | { readonly valid: false; readonly issues: readonly AuditValidationIssue[] };

export class AuditContractError extends Error {
  constructor(readonly issues: readonly AuditValidationIssue[]) {
    super('Audit event violates the platform-audit/1 contract');
    this.name = 'AuditContractError';
  }
}

let compiledSchema: ValidateFunction | undefined;

export function validateAuthenticationAuditEvent(value: unknown): AuditValidationResult {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { valid: false, issues: [{ code: 'invalid_contract', path: '/' }] };
  }
  if (serialized === undefined) {
    return { valid: false, issues: [{ code: 'invalid_contract', path: '/' }] };
  }
  const byteLength = Buffer.byteLength(serialized);
  if (byteLength > MAX_AUDIT_EVENT_BYTES) {
    return { valid: false, issues: [{ code: 'size_exceeded', path: '/' }] };
  }

  const validate = compiledSchema ?? compileSchema();
  if (!validate(value)) {
    return {
      valid: false,
      issues: (validate.errors ?? []).map(toSafeIssue),
    };
  }
  return { valid: true, event: value as AuthenticationAuditEvent, byteLength };
}

export function assertValidAuthenticationAuditEvent(value: unknown): asserts value is AuthenticationAuditEvent {
  const result = validateAuthenticationAuditEvent(value);
  if (!result.valid) {
    throw new AuditContractError(result.issues);
  }
}

function compileSchema(): ValidateFunction {
  const schemaUrl = new URL('../../contract/platform-audit-event-v1.schema.json', import.meta.url);
  const schema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  compiledSchema = validate;
  return validate;
}

function toSafeIssue(error: ErrorObject): AuditValidationIssue {
  const path = error.instancePath.length === 0 ? '/' : error.instancePath;
  if (error.keyword === 'required') {
    return { code: 'missing_field', path };
  }
  if (error.keyword === 'additionalProperties') {
    return { code: 'forbidden_field', path };
  }
  if (path === '/metadata/version' || path === '/unmapped/platform/schema_version') {
    return { code: 'invalid_version', path };
  }
  if (path === '/time') {
    return { code: 'invalid_timestamp', path };
  }
  if (error.keyword === 'enum' || error.keyword === 'const') {
    return { code: 'invalid_enum', path };
  }
  if (error.keyword === 'pattern' || error.keyword === 'format') {
    return { code: 'invalid_format', path };
  }
  return { code: 'invalid_contract', path };
}
