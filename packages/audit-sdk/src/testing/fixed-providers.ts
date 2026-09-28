import type { AuditEventProviders } from '../core/providers.js';

export function createFixedAuditEventProviders(time: number, uuid: string): AuditEventProviders {
  return {
    clock: { now: () => time },
    uuid: { generate: () => uuid },
  };
}
