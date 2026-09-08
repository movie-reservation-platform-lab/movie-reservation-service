import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import {
  buildAuthenticationAuditEvent,
  type AuthenticationAuditEventInput,
} from '../../../src/application/audit/authentication-audit-event';
import contract from '../../fixtures/audit/platform-audit-contract-v1.json';
import schema from '../../fixtures/audit/platform-audit-event-v1.schema.json';

const validate = new Ajv({ strict: false }).compile(schema);

function failureInput(): AuthenticationAuditEventInput {
  return {
    uid: contract.event.metadata.uid,
    time: contract.event.time,
    correlationId: contract.event.metadata.correlation_uid,
    requestId: contract.event.unmapped.platform.request_id,
    serviceName: contract.event.service.name,
    serviceVersion: contract.event.service.version,
    environment: contract.event.unmapped.platform.environment,
    traceId: contract.event.unmapped.platform.trace_id,
    spanId: contract.event.unmapped.platform.span_id,
    awsAlbTraceId: contract.event.unmapped.platform.aws_alb_trace_id,
    outcome: { authenticated: false, reason: 'INVALID_CREDENTIALS' },
    route: '/demo/auth/login',
    authBoundary: 'demo_login',
  };
}

describe('OCSF Authentication builder', () => {
  it('matches the shared platform fixture and schema exactly', () => {
    const event = buildAuthenticationAuditEvent(failureInput());

    expect(event).toEqual(contract.event);
    expect(validate(event)).toBe(true);
  });

  it('records a successful credential check without claiming a session', () => {
    const event = buildAuthenticationAuditEvent({ ...failureInput(), outcome: { authenticated: true } });

    expect(validate(event)).toBe(true);
    expect(event).toMatchObject({
      activity_id: 99,
      status_id: 1,
      status_detail: 'AUTHENTICATED',
      severity_id: 1,
      user: { name: 'demo-user', type_id: 1 },
    });
    expect(event).not.toHaveProperty('session');
  });

  it('omits absent or invalid trace fields instead of making up an active trace', () => {
    const input = { ...failureInput() };
    delete (input as { traceId?: string }).traceId;
    delete (input as { spanId?: string }).spanId;
    delete (input as { awsAlbTraceId?: string }).awsAlbTraceId;
    const event = buildAuthenticationAuditEvent(input);
    expect(event.unmapped.platform).not.toHaveProperty('trace_id');
    expect(event.unmapped.platform).not.toHaveProperty('span_id');
    expect(event.unmapped.platform).not.toHaveProperty('aws_alb_trace_id');
    expect(validate(event)).toBe(true);

    const invalid = buildAuthenticationAuditEvent({ ...input, traceId: '0'.repeat(32), spanId: '0'.repeat(16) });
    expect(invalid.unmapped.platform).not.toHaveProperty('trace_id');
    expect(invalid.unmapped.platform).not.toHaveProperty('span_id');
  });

  it('sanitizes optional ingress headers and drops oversized values', () => {
    const event = buildAuthenticationAuditEvent({
      ...failureInput(),
      awsAlbTraceId: 'Root=abc\r\nInjected=secret\u0000',
      awsCloudfrontRequestId: 'x'.repeat(513),
    });
    expect(event.unmapped.platform.aws_alb_trace_id).toBe('Root=abc  Injected=secret');
    expect(event.unmapped.platform).not.toHaveProperty('aws_cloudfront_request_id');
    expect(validate(event)).toBe(true);
  });

  it.each(['bad\nidentifier', 'x'.repeat(129), '', 'invalid+id'])('rejects unsafe request IDs: %j', (requestId) => {
    expect(() => buildAuthenticationAuditEvent({ ...failureInput(), requestId })).toThrow('bounded printable');
  });

  it('rejects invalid event IDs and timestamps', () => {
    expect(() => buildAuthenticationAuditEvent({ ...failureInput(), uid: 'not-a-uuid' })).toThrow('UUID v4');
    expect(() => buildAuthenticationAuditEvent({ ...failureInput(), time: -1 })).toThrow('epoch milliseconds');
  });
});
