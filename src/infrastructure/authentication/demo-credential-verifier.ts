import { createHash, timingSafeEqual } from 'node:crypto';

import type { DemoCredentialVerifier } from '../../application/authentication/demo-login.service';

export class ConstantTimeDemoCredentialVerifier implements DemoCredentialVerifier {
  private readonly expectedUsername: Buffer;
  private readonly expectedPassword: Buffer;

  constructor(username: string, password: string) {
    this.expectedUsername = hash(username);
    this.expectedPassword = hash(password);
  }

  matches(username: string, password: string): boolean {
    // Always compare both fixed-size values; do not short-circuit on the username.
    const usernameMatches = timingSafeEqual(hash(username), this.expectedUsername);
    const passwordMatches = timingSafeEqual(hash(password), this.expectedPassword);
    return usernameMatches && passwordMatches;
  }
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
