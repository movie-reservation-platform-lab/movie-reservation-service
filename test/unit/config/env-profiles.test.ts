import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const serviceRoot = process.cwd();

describe('committed service env profile templates', () => {
  /**
   * TODO: These tests are intentionally shallow static checks. They protect the
   * current template defaults, but they are not a good long-term substitute for
   * runtime profile smoke tests that start the app with each profile and verify
   * externally visible behavior.
   */
  it.each([
    ['env_files/templates/local-fixed-user.env.template', 'local-fixed-user'],
    ['env_files/templates/local-jwt.env.template', 'local-jwt'],
    ['env_files/templates/production-oidc.env.template', 'oidc'],
  ])('%s selects the expected auth mode', (relativePath, expectedAuthMode) => {
    const profile = readEnvProfile(relativePath);

    expect(profile.AUTH_MODE).toBe(expectedAuthMode);
  });

  it.each([
    ['env_files/templates/local-fixed-user.env.template', 'true'],
    ['env_files/templates/local-jwt.env.template', 'true'],
    ['env_files/templates/production-oidc.env.template', 'false'],
  ])(
    '%s selects the expected GraphiQL exposure',
    (relativePath, expectedEnableGraphiql) => {
      const profile = readEnvProfile(relativePath);

      expect(profile.ENABLE_GRAPHIQL).toBe(expectedEnableGraphiql);
    },
  );
});

function readEnvProfile(relativePath: string): Record<string, string> {
  const profile: Record<string, string> = {};

  for (const line of readFileSync(join(serviceRoot, relativePath), 'utf8')
    .split('\n')
    .filter((profileLine) => {
      return profileLine.length > 0 && !profileLine.startsWith('#');
    })) {
    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    profile[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }

  return profile;
}
