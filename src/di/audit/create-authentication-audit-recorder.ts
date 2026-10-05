import type { AuthenticationAuditRecorder } from '../../application/audit/ports/authentication-audit-recorder';
import { config, type AuditPublisherSettings } from '../../config';
import { RequestAuthenticationAuditRecorder } from '../../infrastructure/audit/request-authentication-audit-recorder';
import { applicationLogger } from '../../infrastructure/observability/application-logger';
import { createAuditPublisher } from './create-audit-publisher';

export function createAuthenticationAuditRecorder(
  settings: AuditPublisherSettings = config.AUDIT,
): AuthenticationAuditRecorder {
  const publisher = createAuditPublisher(settings);
  // The bus ARN stays out of logs: it names the audit account.
  applicationLogger.info('audit.publisher.selected', {
    audit_publisher: settings.publisher,
    ...(settings.publisher === 'eventbridge'
      ? { stdout_comparison_mirror: settings.stdoutComparisonMirror, publish_timeout_ms: settings.timeoutMs }
      : {}),
  });
  return new RequestAuthenticationAuditRecorder(
    {
      serviceName: 'movie-reservation-service',
      serviceVersion: config.SERVICE_VERSION,
      environment: config.DEPLOYMENT_ENVIRONMENT,
    },
    publisher,
    applicationLogger,
  );
}
