/**
 * Request-scoped observability context.
 *
 * Leveraging of async local storage for propagating business context for the
 * request/response lifecycle. The HTTP boundary creates an AsyncLocalStorage
 * context, later boundaries enrich it with authenticated user and GraphQL
 * operation metadata, and the application logger reads the active context
 * for every log emitted inside that async lifecycle.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthenticatedUser } from '../../domain/authentication/authenticated-user';
import type { ReservationWorkObservabilityContext } from '../../application/movie-reservations/ports/reservation-work-observability-context-provider';
import { getActivePropagationHeaders } from './trace-propagation';

/**
 * Mutable-by-replacement context for one inbound request lifecycle.
 *
 * The object itself is treated as immutable. Enrichment functions replace the
 * active AsyncLocalStorage value with a shallow copy that includes additional
 * facts discovered later in the request, such as auth identity or GraphQL
 * operation metadata.
 */
export interface RequestContext {
  /** Workflow id supplied by the caller or generated at the HTTP boundary. */
  readonly correlationId: string;
  /** Per-HTTP-request id retained for response headers and async handoff context. */
  readonly requestId: string;
  /** W3C trace propagation header captured from the inbound request. */
  readonly traceparent?: string;
  /** Optional W3C vendor trace state captured from the inbound request. */
  readonly tracestate?: string;
  /** AWS edge/proxy trace metadata used only as a secondary cross-check. */
  readonly awsXAmznTraceId?: string;
  /** Inbound HTTP method captured by the HTTP boundary. */
  readonly method?: string;
  /** Inbound route/path captured by the HTTP boundary. */
  readonly path?: string;
  /** Authenticated application user id, added after auth middleware resolves. */
  readonly userId?: string;
  /** Internal provider id kept in context for code paths that still need it. */
  readonly movieProviderId?: string;
  /** Provider code used for log enrichment because it is lower-noise than the provider id. */
  readonly movieProviderCode?: string;
  /** GraphQL operation name added after Apollo resolves the operation. */
  readonly graphqlOperationName?: string;
  /** GraphQL operation type, for example `query` or `mutation`. */
  readonly graphqlOperationType?: string;
  /** Bounded application operation name for log grouping and metrics. */
  readonly businessOperation?: string;
}

/**
 * GraphQL metadata that becomes available after Apollo parses and resolves the operation.
 *
 * Logs emitted before that lifecycle point cannot be enriched with
 * these fields because the operation has not been identified yet.
 */
export interface GraphqlOperationContextInput {
  readonly operationName: string;
  readonly operationType: string;
  readonly businessOperation: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** Runs the callback inside the provided request context. */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStorage.run(context, callback);
}

/** Returns the active request context, if the current async chain is request-scoped. */
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Adds authenticated identity to the active request context.
 *
 * This is intentionally no-op outside a request context so tests, startup code,
 * and background tasks can call shared code without needing a fake request.
 */
export function enrichRequestContextWithAuthenticatedUser(user: AuthenticatedUser): void {
  const currentContext = requestContextStorage.getStore();

  if (currentContext === undefined) {
    return;
  }

  const movieProviderCodeContainer =
    user.movieProviderCode === undefined ? {} : { movieProviderCode: user.movieProviderCode };

  requestContextStorage.enterWith({
    ...currentContext,
    userId: user.userId,
    movieProviderId: user.movieProviderId,
    ...movieProviderCodeContainer,
  });
}

/**
 * Adds GraphQL operation metadata to the active request context.
 *
 * Once Apollo has resolved the operation, subsequent business logs in the same
 * async lifecycle inherit the operation fields automatically through the
 * application logger.
 */
export function enrichRequestContextWithGraphqlOperation(input: GraphqlOperationContextInput): void {
  const currentContext = requestContextStorage.getStore();

  if (currentContext === undefined) {
    return;
  }

  requestContextStorage.enterWith({
    ...currentContext,
    graphqlOperationName: input.operationName,
    graphqlOperationType: input.operationType,
    businessOperation: input.businessOperation,
  });
}

/**
 * Builds the minimal observability context persisted with async reservation work.
 *
 * The worker uses this to continue trace propagation and preserve correlation
 * across the API-to-worker handoff. It requires a traceparent because without
 * trace propagation metadata the worker cannot continue the original trace.
 */
export function getCurrentReservationWorkObservabilityContext(): ReservationWorkObservabilityContext | undefined {
  const currentContext = requestContextStorage.getStore();

  if (currentContext === undefined) {
    return undefined;
  }

  const activePropagationHeaders = getActivePropagationHeaders();
  const activeTraceparent = activePropagationHeaders.traceparent ?? currentContext.traceparent;

  if (activeTraceparent === undefined) {
    return undefined;
  }

  const tracestate = activePropagationHeaders.tracestate ?? currentContext.tracestate;
  const traceStateContainer = tracestate === undefined ? {} : { tracestate };

  return {
    correlationId: currentContext.correlationId,
    requestId: currentContext.requestId,
    traceparent: activeTraceparent,
    ...traceStateContainer,
  };
}
