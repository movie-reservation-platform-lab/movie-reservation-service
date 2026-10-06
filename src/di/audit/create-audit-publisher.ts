import type { AuditPublisher } from '@movie-reservation-platform-lab/audit-sdk/core';
import {
  createEventBridgeAuditPublisher,
  type EventBridgeAuditPublisherConfig,
} from '@movie-reservation-platform-lab/audit-sdk/eventbridge';

import type { AuditPublisherSettings } from '../../config';
import { MeteredAuditPublisher } from '../../infrastructure/audit/metered-audit-publisher';
import { StdoutAuditPublisher } from '../../infrastructure/audit/stdout-audit-publisher';
import { StdoutComparisonMirrorAuditPublisher } from '../../infrastructure/audit/stdout-comparison-mirror-audit-publisher';
import { applicationLogger } from '../../infrastructure/observability/application-logger';
import {
  initializeAuditPublishMetricSeries,
  type AuditPublisherName,
  type AuditPublisherRole,
} from '../../infrastructure/observability/metrics/audit-publish-metrics';

export interface AuditPublisherDependencies {
  readonly stdout: AuditPublisher;
  readonly createEventBridge: (config: EventBridgeAuditPublisherConfig) => AuditPublisher;
}

/**
 * Builds the configured publisher graph; every publisher is metered:
 *
 * - `stdout`: stdout (primary)
 * - `eventbridge`: EventBridge (primary)
 * - `eventbridge` + mirror: EventBridge (primary), then stdout (comparison)
 *
 * An invalid bus ARN throws `AuditPublisherConfigurationError` here, so the
 * service fails at startup rather than on the first login.
 */
export function createAuditPublisher(
  settings: AuditPublisherSettings,
  dependencies: AuditPublisherDependencies = defaultAuditPublisherDependencies(),
): AuditPublisher {
  if (settings.publisher === 'stdout') {
    return metered(dependencies.stdout, 'stdout', 'primary');
  }

  const primaryPublisher = metered(
    dependencies.createEventBridge({ eventBusArn: settings.eventBusArn, timeoutMs: settings.timeoutMs }),
    'eventbridge',
    'primary',
  );
  if (!settings.stdoutComparisonMirror) {
    return primaryPublisher;
  }
  const comparisonPublisher = metered(dependencies.stdout, 'stdout', 'comparison');
  return new StdoutComparisonMirrorAuditPublisher(primaryPublisher, comparisonPublisher);
}

function metered(
  innerPublisher: AuditPublisher,
  publisher: AuditPublisherName,
  role: AuditPublisherRole,
): AuditPublisher {
  initializeAuditPublishMetricSeries(publisher, role);
  return new MeteredAuditPublisher(innerPublisher, { publisher, role });
}

function defaultAuditPublisherDependencies(): AuditPublisherDependencies {
  return {
    stdout: new StdoutAuditPublisher(process.stdout, (reason) => {
      applicationLogger.error('audit.stdout.failed', { failure_reason: reason });
    }),
    createEventBridge: createEventBridgeAuditPublisher,
  };
}
