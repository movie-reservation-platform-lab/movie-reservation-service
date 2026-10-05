import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

import {
  AuditPublisherConfigurationError,
  EventBridgeAuditPublisher,
  type EventBridgeAuditPublisherConfig,
} from './eventbridge-audit-publisher.js';

const eventBusRegionPattern = /^arn:[a-z-]+:events:([a-z0-9-]+):/;

/**
 * Builds the AWS client with the package's transport policy and wraps it in an
 * `EventBridgeAuditPublisher`, so consumers never construct or pin the AWS SDK.
 *
 * - One attempt per publish: the SDK default retries up to three times, which
 *   adds load during throttling and hides failures from producer metrics.
 *   Retrying belongs to a durable relay, not to a request waiting on audit.
 * - The client Region comes from the bus ARN, so it cannot drift from the bus.
 *
 * Credentials and endpoint resolution use the AWS SDK defaults (for example the
 * ECS task role). Call once per process and reuse the publisher.
 */
export function createEventBridgeAuditPublisher(config: EventBridgeAuditPublisherConfig): EventBridgeAuditPublisher {
  return new EventBridgeAuditPublisher(createEventBridgeAuditClient(config.eventBusArn), config);
}

/** Exposed for tests of the client policy; prefer `createEventBridgeAuditPublisher`. */
export function createEventBridgeAuditClient(eventBusArn: string): EventBridgeClient {
  const region = eventBusRegionPattern.exec(eventBusArn)?.[1];
  if (region === undefined) {
    throw new AuditPublisherConfigurationError('eventBusArn');
  }
  return new EventBridgeClient({ region, maxAttempts: 1 });
}
