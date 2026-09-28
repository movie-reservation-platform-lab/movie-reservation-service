import { PutEventsCommand, type PutEventsCommandOutput } from '@aws-sdk/client-eventbridge';

import {
  assertValidAuthenticationAuditEvent,
  type AuditPublishOptions,
  type AuditPublishResult,
  type AuditPublisher,
  type AuthenticationAuditEvent,
} from '../core/index.js';
import {
  AUDIT_EVENTBRIDGE_DETAIL_TYPE,
  AUDIT_EVENTBRIDGE_ENVELOPE_VERSION,
  AUDIT_EVENTBRIDGE_SOURCES,
} from './constants.js';
import { inspectPutEventsResponse } from './inspect-put-events-response.js';

export interface EventBridgeClientLike {
  send(command: PutEventsCommand, options?: { readonly abortSignal?: AbortSignal }): Promise<PutEventsCommandOutput>;
}

export interface EventBridgeAuditPublisherConfig {
  readonly eventBusArn: string;
  readonly timeoutMs: number;
  readonly resources?: readonly string[];
}

export type AuditPublisherConfigurationField = 'eventBusArn' | 'timeoutMs' | 'resources';

export interface EventBridgeAuditEnvelope {
  readonly envelope_version: typeof AUDIT_EVENTBRIDGE_ENVELOPE_VERSION;
  readonly event: AuthenticationAuditEvent;
}

export class AuditPublisherConfigurationError extends Error {
  constructor(readonly field: AuditPublisherConfigurationField) {
    super(`Invalid EventBridge audit publisher configuration: ${field}`);
    this.name = 'AuditPublisherConfigurationError';
  }
}

const eventBusArnPattern = /^arn:(?:aws|aws-cn|aws-us-gov):events:[a-z0-9-]+:\d{12}:event-bus\/[A-Za-z0-9._/-]{1,256}$/;

export class EventBridgeAuditPublisher implements AuditPublisher {
  private readonly eventBusArn: string;
  private readonly timeoutMs: number;
  private readonly resources: readonly string[];

  constructor(
    private readonly client: EventBridgeClientLike,
    config: EventBridgeAuditPublisherConfig,
  ) {
    if (!eventBusArnPattern.test(config.eventBusArn)) {
      throw new AuditPublisherConfigurationError('eventBusArn');
    }
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30_000) {
      throw new AuditPublisherConfigurationError('timeoutMs');
    }
    if (
      (config.resources?.length ?? 0) > 5 ||
      config.resources?.some((resource) => !isBoundedResourceArn(resource)) === true
    ) {
      throw new AuditPublisherConfigurationError('resources');
    }
    this.eventBusArn = config.eventBusArn;
    this.timeoutMs = config.timeoutMs;
    this.resources = config.resources === undefined ? [] : [...config.resources];
  }

  async publish(event: AuthenticationAuditEvent, options: AuditPublishOptions = {}): Promise<AuditPublishResult> {
    assertValidAuthenticationAuditEvent(event);
    if (isAborted(options.signal)) {
      return rejected(event, 'aborted');
    }

    const envelope: EventBridgeAuditEnvelope = {
      envelope_version: AUDIT_EVENTBRIDGE_ENVELOPE_VERSION,
      event,
    };
    const command = new PutEventsCommand({
      Entries: [
        {
          Source: AUDIT_EVENTBRIDGE_SOURCES[event.service.name],
          DetailType: AUDIT_EVENTBRIDGE_DETAIL_TYPE,
          EventBusName: this.eventBusArn,
          Detail: JSON.stringify(envelope),
          ...(this.resources.length === 0 ? {} : { Resources: [...this.resources] }),
        },
      ],
    });

    const controller = new AbortController();
    let resolveBoundary!: (reason: 'timeout' | 'aborted') => void;
    const boundary = new Promise<'timeout' | 'aborted'>((resolve) => {
      resolveBoundary = resolve;
    });
    const abortFromCaller = () => {
      resolveBoundary('aborted');
      controller.abort();
    };
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      resolveBoundary('timeout');
      controller.abort();
    }, this.timeoutMs);

    try {
      const transport = this.client.send(command, { abortSignal: controller.signal }).then(
        (response) => ({ response }) as const,
        (error: unknown) => ({ error }) as const,
      );
      const outcome = await Promise.race([transport, boundary]);
      if (outcome === 'timeout' || outcome === 'aborted') {
        return rejected(event, outcome);
      }
      if ('error' in outcome) {
        return rejected(event, classifyTransportError(outcome.error));
      }
      return inspectPutEventsResponse(outcome.response, event.metadata.uid);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

function rejected(
  event: AuthenticationAuditEvent,
  reason: Extract<AuditPublishResult, { accepted: false }>['reason'],
): AuditPublishResult {
  return { accepted: false, auditEventId: event.metadata.uid, reason };
}

function classifyTransportError(error: unknown): 'throttled' | 'configuration' | 'unavailable' {
  const name = readErrorName(error);
  if (name === 'ThrottlingException' || name === 'TooManyRequestsException') {
    return 'throttled';
  }
  if (
    name === 'InvalidArgument' ||
    name === 'InvalidParameterException' ||
    name === 'ResourceNotFoundException' ||
    name === 'AccessDeniedException'
  ) {
    return 'configuration';
  }
  return 'unavailable';
}

function readErrorName(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('name' in error)) {
    return undefined;
  }
  return typeof error.name === 'string' ? error.name : undefined;
}

function isBoundedResourceArn(resource: string): boolean {
  return (
    resource.length >= 5 && resource.length <= 2_048 && resource.startsWith('arn:') && !/[\p{Cc}\p{Cf}]/u.test(resource)
  );
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
