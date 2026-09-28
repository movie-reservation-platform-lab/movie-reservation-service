import { randomUUID } from 'node:crypto';

export interface AuditClock {
  now(): number;
}

export interface AuditUuidProvider {
  generate(): string;
}

export interface AuditEventProviders {
  readonly clock: AuditClock;
  readonly uuid: AuditUuidProvider;
}

export const systemAuditEventProviders: AuditEventProviders = {
  clock: { now: () => Date.now() },
  uuid: { generate: () => randomUUID() },
};
