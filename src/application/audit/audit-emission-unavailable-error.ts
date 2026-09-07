/** The process could not accept an audit line; no claim about remote delivery. */
export class AuditEmissionUnavailableError extends Error {
  constructor() {
    super('Audit emission unavailable');
    this.name = 'AuditEmissionUnavailableError';
  }
}
