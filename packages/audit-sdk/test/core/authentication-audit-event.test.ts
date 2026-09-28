import { describe, expect, it } from 'vitest';

import {
  AuditContractError,
  buildAuthenticationAuditEvent,
  MAX_AUDIT_EVENT_BYTES,
  redactSensitiveValues,
  REDACTED_AUDIT_VALUE,
  validateAuthenticationAuditEvent,
  type AuthenticationAuditEventInput,
} from '../../src/core/index.js';
import {
  canonicalAcceptedAuthenticationEvent,
  canonicalRejectedAuthenticationEvent,
  createFixedAuditEventProviders,
} from '../../src/testing/index.js';

const rejectedInput: AuthenticationAuditEventInput = {
  outcome: { authenticated: false, reason: 'INVALID_CREDENTIALS' },
  route: '/demo/auth/login',
  authBoundary: 'demo_login',
  correlationId: 'demo-action-001',
  requestId: 'demo-request-001',
  serviceName: 'movie-reservation-service',
  serviceVersion: 'demo-build-001',
  environment: 'demo',
  traceId: '6a9dd2710123456789abcdef01234567',
  spanId: '0123456789abcdef',
  awsAlbTraceId: 'Root=1-6a9dd271-0123456789abcdef01234567',
};

interface MutableContractEvent {
  metadata: { version: string };
  status_detail: string;
  time: number;
}

describe('OCSF Authentication contract', () => {
  it('accepts both canonical contract examples', () => {
    expect(validateAuthenticationAuditEvent(canonicalRejectedAuthenticationEvent)).toMatchObject({ valid: true });
    expect(validateAuthenticationAuditEvent(canonicalAcceptedAuthenticationEvent)).toMatchObject({ valid: true });
  });

  it('builds the canonical rejected example with deterministic providers', () => {
    const providers = createFixedAuditEventProviders(
      canonicalRejectedAuthenticationEvent.time,
      canonicalRejectedAuthenticationEvent.metadata.uid,
    );
    expect(buildAuthenticationAuditEvent(rejectedInput, providers)).toEqual(canonicalRejectedAuthenticationEvent);
  });

  it('builds the canonical accepted example with deterministic providers', () => {
    const providers = createFixedAuditEventProviders(
      canonicalAcceptedAuthenticationEvent.time,
      canonicalAcceptedAuthenticationEvent.metadata.uid,
    );
    expect(
      buildAuthenticationAuditEvent(
        {
          ...rejectedInput,
          outcome: { authenticated: true },
          correlationId: 'demo-action-002',
          requestId: 'demo-request-002',
          traceId: undefined,
          spanId: undefined,
          awsAlbTraceId: undefined,
        },
        providers,
      ),
    ).toEqual(canonicalAcceptedAuthenticationEvent);
  });

  it.each([
    ['version', (event: MutableContractEvent) => (event.metadata.version = '2.0.0'), 'invalid_version'],
    ['enum', (event: MutableContractEvent) => (event.status_detail = 'RAW_EXCEPTION'), 'invalid_enum'],
    ['timestamp', (event: MutableContractEvent) => (event.time = -1), 'invalid_timestamp'],
  ])('rejects an invalid %s without echoing its value', (_name, mutate, expectedCode) => {
    const event = structuredClone(canonicalRejectedAuthenticationEvent) as unknown as MutableContractEvent;
    mutate(event);
    const result = validateAuthenticationAuditEvent(event);
    expect(result.valid).toBe(false);
    const issueCodes = result.valid ? [] : result.issues.map((issue) => issue.code);
    expect(issueCodes).toContain(expectedCode);
    expect(JSON.stringify(result)).not.toContain('RAW_EXCEPTION');
    expect(JSON.stringify(result)).not.toContain('2.0.0');
  });

  it('rejects an event above the bounded serialized size', () => {
    const event = structuredClone(canonicalRejectedAuthenticationEvent);
    event.unmapped.platform.environment = 'x'.repeat(MAX_AUDIT_EVENT_BYTES);
    expect(validateAuthenticationAuditEvent(event)).toEqual({
      valid: false,
      issues: [{ code: 'size_exceeded', path: '/' }],
    });
  });

  it('redacts credential keys, authorization values, caller-known secrets, deep values, and cycles', () => {
    const value: Record<string, unknown> = {
      username: 'safe-user',
      password: 'credential-value',
      nested: {
        authorization: 'Bearer header-value',
        message: 'failed for credential-value',
        deeper: { token: 'token-value' },
      },
    };
    value.cycle = value;

    expect(redactSensitiveValues(value, { sensitiveValues: ['credential-value'], maxDepth: 2 })).toEqual({
      username: 'safe-user',
      password: REDACTED_AUDIT_VALUE,
      nested: {
        authorization: REDACTED_AUDIT_VALUE,
        message: `failed for ${REDACTED_AUDIT_VALUE}`,
        deeper: REDACTED_AUDIT_VALUE,
      },
      cycle: REDACTED_AUDIT_VALUE,
    });
  });

  it('copies __proto__ as an ordinary data property during redaction', () => {
    const untrusted = JSON.parse('{"__proto__":{"attackerControlled":true},"safe":"value"}') as unknown;
    const redacted = redactSensitiveValues(untrusted) as Record<string, unknown>;

    expect(Object.hasOwn(redacted, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
    expect(redacted['__proto__']).toEqual({ attackerControlled: true });
    expect(redacted['safe']).toBe('value');
  });

  it('rejects unexpected runtime input fields without including credential values in the error', () => {
    const unsafeInput = { ...rejectedInput, password: 'do-not-leak-this' };
    let actualError: unknown;
    try {
      buildAuthenticationAuditEvent(
        unsafeInput,
        createFixedAuditEventProviders(1788814800000, '11111111-1111-4111-8111-111111111111'),
      );
    } catch (error) {
      actualError = error;
    }
    expect(actualError).toBeInstanceOf(AuditContractError);
    expect(JSON.stringify(actualError)).not.toContain('do-not-leak-this');
  });
});
