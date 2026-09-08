import type { AuthenticationAuditRecorder } from '../../application/audit/ports/authentication-audit-recorder';
import { config } from '../../config';
import { RequestAuthenticationAuditRecorder } from '../../infrastructure/audit/request-authentication-audit-recorder';
import { StdoutAuditEventSink } from '../../infrastructure/audit/stdout-audit-event-sink';
import { applicationLogger } from '../../infrastructure/observability/application-logger';

export function createAuthenticationAuditRecorder(): AuthenticationAuditRecorder {
  const sink = new StdoutAuditEventSink(process.stdout, (reason) => {
    applicationLogger.error('audit.stdout.failed', { failure_reason: reason });
  });
  return new RequestAuthenticationAuditRecorder(
    {
      serviceName: 'movie-reservation-service',
      serviceVersion: config.SERVICE_VERSION,
      environment: config.DEPLOYMENT_ENVIRONMENT,
    },
    sink,
    applicationLogger,
  );
}
