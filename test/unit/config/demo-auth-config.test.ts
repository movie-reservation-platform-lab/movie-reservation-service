import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/config';

describe('demo authentication configuration', () => {
  it('is disabled by default without credentials', () => {
    expect(parseConfig({}).DEMO_AUTH).toEqual({ enabled: false });
    expect(parseConfig({}).DEPLOYMENT_ENVIRONMENT).toBe('local');
  });

  it.each([
    {},
    { DEMO_AUTH_USERNAME: 'demo' },
    { DEMO_AUTH_PASSWORD: 'test-only' },
    { DEMO_AUTH_USERNAME: ' ', DEMO_AUTH_PASSWORD: 'test-only' },
    { DEMO_AUTH_USERNAME: 'demo', DEMO_AUTH_PASSWORD: '\t' },
  ])('rejects incomplete enabled credentials %#', (credentials) => {
    expect(() => parseConfig({ DEMO_AUTH_ENABLED: 'true', ...credentials })).toThrow('required');
  });

  it('preserves explicitly configured credential bytes', () => {
    expect(
      parseConfig({
        DEMO_AUTH_ENABLED: 'true',
        DEMO_AUTH_USERNAME: 'demo-user',
        DEMO_AUTH_PASSWORD: ' test-only-secret ',
        DEPLOYMENT_ENVIRONMENT: 'demo',
      }).DEMO_AUTH,
    ).toEqual({ enabled: true, username: 'demo-user', password: ' test-only-secret ' });
  });

  it.each(['staging', 'production'])('rejects enabled demo authentication in %s', (nodeEnv) => {
    expect(() =>
      parseConfig({
        NODE_ENV: nodeEnv,
        COMPOSITION_PROFILE: 'production-oidc',
        DATABASE_URL: 'postgres://unused:unused@localhost/unused',
        DEMO_AUTH_ENABLED: 'true',
        DEMO_AUTH_USERNAME: 'demo',
        DEMO_AUTH_PASSWORD: 'test-only',
      }),
    ).toThrow('demo authentication is only allowed');
  });

  it('rejects accidental truthy strings and oversized credentials', () => {
    expect(() => parseConfig({ DEMO_AUTH_ENABLED: 'yes' })).toThrow('Invalid option');
    expect(() => parseConfig({ DEMO_AUTH_USERNAME: 'x'.repeat(257) })).toThrow('Too big');
    expect(() => parseConfig({ DEMO_AUTH_PASSWORD: 'x'.repeat(1025) })).toThrow('Too big');
  });
});
