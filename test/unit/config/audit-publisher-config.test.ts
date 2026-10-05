import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/config';

const eventBusArn = 'arn:aws:events:eu-central-1:222222222222:event-bus/movie-platform-audit';

describe('audit publisher configuration', () => {
  it('defaults to stdout', () => {
    expect(parseConfig({}).AUDIT).toEqual({ publisher: 'stdout' });
  });

  it('parses the infrastructure contract for EventBridge with the comparison mirror', () => {
    expect(
      parseConfig({
        AUDIT_PUBLISHER: 'eventbridge',
        AUDIT_EVENT_BUS_ARN: eventBusArn,
        AUDIT_PUBLISH_TIMEOUT_MS: '1000',
        AUDIT_STDOUT_COMPARISON_MIRROR: 'true',
      }).AUDIT,
    ).toEqual({ publisher: 'eventbridge', eventBusArn, timeoutMs: 1_000, stdoutComparisonMirror: true });
  });

  it('defaults the EventBridge timeout to 1000 ms and the mirror to off', () => {
    expect(parseConfig({ AUDIT_PUBLISHER: 'eventbridge', AUDIT_EVENT_BUS_ARN: eventBusArn }).AUDIT).toEqual({
      publisher: 'eventbridge',
      eventBusArn,
      timeoutMs: 1_000,
      stdoutComparisonMirror: false,
    });
  });

  it.each([undefined, '', '  '])('requires a bus ARN for EventBridge (%j)', (arn) => {
    expect(() =>
      parseConfig({ AUDIT_PUBLISHER: 'eventbridge', ...(arn === undefined ? {} : { AUDIT_EVENT_BUS_ARN: arn }) }),
    ).toThrow('AUDIT_EVENT_BUS_ARN is required when AUDIT_PUBLISHER is eventbridge');
  });

  it.each(['99', '5001', '1000.5', 'abc'])('rejects timeout %s outside the 100-5000 ms integer contract', (timeout) => {
    expect(() =>
      parseConfig({
        AUDIT_PUBLISHER: 'eventbridge',
        AUDIT_EVENT_BUS_ARN: eventBusArn,
        AUDIT_PUBLISH_TIMEOUT_MS: timeout,
      }),
    ).toThrow('AUDIT_PUBLISH_TIMEOUT_MS');
  });

  it.each(['100', '5000'])('accepts the timeout boundary %s', (timeout) => {
    const audit = parseConfig({
      AUDIT_PUBLISHER: 'eventbridge',
      AUDIT_EVENT_BUS_ARN: eventBusArn,
      AUDIT_PUBLISH_TIMEOUT_MS: timeout,
    }).AUDIT;
    expect(audit.publisher === 'eventbridge' && audit.timeoutMs).toBe(Number(timeout));
  });

  it('rolls back by switching only AUDIT_PUBLISHER: the other injected settings are ignored', () => {
    expect(
      parseConfig({
        NODE_ENV: 'production',
        COMPOSITION_PROFILE: 'production-oidc',
        DATABASE_URL: 'postgres://unused:unused@localhost/unused',
        AUDIT_PUBLISHER: 'stdout',
        AUDIT_EVENT_BUS_ARN: eventBusArn,
        AUDIT_PUBLISH_TIMEOUT_MS: '1000',
        AUDIT_STDOUT_COMPARISON_MIRROR: 'true',
      }).AUDIT,
    ).toEqual({ publisher: 'stdout' });
  });

  it('rejects unknown publishers and accidental truthy mirror values', () => {
    expect(() => parseConfig({ AUDIT_PUBLISHER: 'noop' })).toThrow('Invalid option');
    expect(() => parseConfig({ AUDIT_STDOUT_COMPARISON_MIRROR: 'yes' })).toThrow('Invalid option');
  });
});
