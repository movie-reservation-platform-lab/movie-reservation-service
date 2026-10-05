/** The audit publisher did not accept the event; no claim about downstream delivery. */
export class AuditEmissionUnavailableError extends Error {
  constructor() {
    super('Audit emission unavailable');
    this.name = 'AuditEmissionUnavailableError';
  }
}
