import type { ApolloServerPlugin } from '@apollo/server';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { Kind, type GraphQLError, type OperationDefinitionNode, type OperationTypeNode } from 'graphql';

import type { MovieReservationBusinessOperation } from '../../../application/movie-reservations/ports/movie-reservation-observability';
import {
  applicationLogger,
  type ApplicationLogger,
  type LogFields,
} from '../../../infrastructure/observability/application-logger';
import { enrichRequestContextWithGraphqlOperation } from '../../../infrastructure/observability/request-context';
import { classifyDiagnosticException } from '../../../infrastructure/observability/metrics/diagnostic-exception-classification';
import {
  incrementGraphqlExceptionCount,
  recordGraphqlOperationMetrics,
  type GraphqlOperationOutcome,
} from '../../../infrastructure/observability/metrics/graphql-operation-metrics';
import type { MovieReservationGraphqlContext } from '../graphql-context';

export type GraphqlOperationLogger = ApplicationLogger;

/**
 * Stable metadata attached to every GraphQL operation log, metric, and span.
 *
 * The values start with safe fallbacks because Apollo creates request state
 * before it has resolved the concrete GraphQL operation.
 */
interface GraphqlOperationLogMetadata {
  readonly operationName: string;
  readonly operationType: OperationTypeNode | 'unknown';
  readonly businessOperation: MovieReservationBusinessOperation;
  readonly movieProviderCode: string;
  readonly userId: string;
}

/**
 * Mutable lifecycle state for one Apollo GraphQL request.
 *
 * Apollo exposes start, operation resolution, error, and response callbacks
 * separately, so this object carries timing, span, and terminal-log guards
 * across those callbacks.
 */
interface GraphqlOperationLogRequestState {
  readonly startedAt: bigint;
  readonly span: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']>;
  metadata: GraphqlOperationLogMetadata;
  operationStartLogged: boolean;
  terminalLogWritten: boolean;
}

/**
 * Narrow response shape needed to inspect GraphQL execution errors.
 *
 * Apollo's concrete response type is wider than this plugin needs. This local
 * shape keeps the error inspection dependency small and easy to fake in tests.
 */
interface GraphqlOperationResponse {
  readonly body: {
    readonly kind: string;
    readonly singleResult?: {
      readonly errors?: readonly unknown[];
    };
  };
}

/** Placeholder used until Apollo resolves the operation name, or when the client omits one. */
const anonymousOperationName = 'anonymous';
const tracer = trace.getTracer('movie-reservation-service.graphql');

/**
 * Apollo plugin for structured GraphQL operation observability.
 *
 * Apollo gives us operation lifecycle callbacks after HTTP middleware and
 * authentication have run. That makes this boundary the right place for
 * GraphQL-specific facts such as operation name, operation type, top-level
 * business operation, duration, and GraphQL errors.
 */
export function createGraphqlOperationLoggingPlugin(
  logger: GraphqlOperationLogger = applicationLogger,
): ApolloServerPlugin<MovieReservationGraphqlContext> {
  return {
    async requestDidStart(requestContext) {
      const state = createRequestLogState(requestContext.contextValue);

      return {
        async didResolveOperation(resolvedOperationContext) {
          const businessOperation = resolveBusinessOperation(resolvedOperationContext.operation);

          state.metadata = {
            ...state.metadata,
            operationName: resolvedOperationContext.operationName ?? anonymousOperationName,
            operationType: resolvedOperationContext.operation?.operation ?? 'unknown',
            businessOperation,
          };
          enrichRequestContextWithGraphqlOperation({
            operationName: sanitizeLogToken(state.metadata.operationName),
            operationType: sanitizeLogToken(state.metadata.operationType),
            businessOperation: state.metadata.businessOperation,
          });
          annotateSpan(state);
          ensureOperationStartLogged(logger, state);
        },

        async didEncounterErrors(errorContext) {
          logOperationFailure(logger, state, errorContext.errors);
        },

        async willSendResponse(responseContext) {
          if (state.terminalLogWritten) {
            return;
          }

          if (readResponseErrors(responseContext.response).length > 0) {
            logOperationFailure(logger, state, []);
            return;
          }

          logOperationFinish(logger, state);
        },
      };
    },

    async contextCreationDidFail({ error }) {
      logger.error(
        'graphql.context.failure',
        { error_type: error.constructor.name, error_message: error.message },
        error,
      );
      recordGraphqlOperationMetrics({
        businessOperation: 'unknown',
        operationType: 'unknown',
        outcome: 'auth_error',
        durationMs: 0,
      });
    },

    async unexpectedErrorProcessingRequest({ error }) {
      logger.error(
        'graphql.operation.unexpected_error',
        { error_type: error.constructor.name, error_message: error.message },
        error,
      );
      recordGraphqlOperationMetrics({
        businessOperation: 'unknown',
        operationType: 'unknown',
        outcome: 'unexpected_error',
        durationMs: 0,
      });
    },
  };
}

/**
 * Creates the per-request state before Apollo has parsed and resolved the operation.
 *
 * Only authenticated user/provider context is available at this point. Operation
 * name, type, and business operation are filled in later by `didResolveOperation`.
 */
function createRequestLogState(context: MovieReservationGraphqlContext): GraphqlOperationLogRequestState {
  return {
    startedAt: process.hrtime.bigint(),
    span: tracer.startSpan('graphql.operation'),
    metadata: createInitialMetadata(context),
    operationStartLogged: false,
    terminalLogWritten: false,
  };
}

/**
 * Writes the terminal failure log and metrics for an operation.
 *
 * This is used both when Apollo directly reports execution errors and when the
 * final response contains errors but no earlier error callback produced the
 * terminal log.
 */
function logOperationFailure(
  logger: GraphqlOperationLogger,
  state: GraphqlOperationLogRequestState,
  errors: readonly GraphQLError[],
): void {
  ensureOperationStartLogged(logger, state);
  const durationMs = calculateDurationMs(state.startedAt);
  const outcome = classifyGraphqlOutcome(errors);
  const errorTypes = errors.map((error) => getGraphqlErrorType(error));
  const errorMessages = errors.map((error) => error.message);

  state.terminalLogWritten = true;
  state.span.setStatus({
    code: SpanStatusCode.ERROR,
    message: errorMessages.join(' | ') || outcome,
  });
  state.span.setAttribute('graphql.error.count', errors.length);
  state.span.end();

  logger.error(
    'graphql.operation.failure',
    createOperationLogFields(state, {
      duration_ms: durationMs,
      outcome,
      error_count: errors.length,
      error_types: errorTypes,
      error_messages: errorMessages,
    }),
    errors[0]?.originalError ?? errors[0],
  );
  recordGraphqlOperationMetrics({
    businessOperation: state.metadata.businessOperation,
    operationType: state.metadata.operationType,
    outcome,
    durationMs,
  });

  for (const error of errors) {
    incrementGraphqlExceptionCount({
      businessOperation: state.metadata.businessOperation,
      exceptionType: classifyDiagnosticException(error.originalError ?? error),
    });
  }
}

/**
 * Writes the terminal success log and metrics for an operation.
 *
 * The span is ended here because Apollo's response callback is the first point
 * where the plugin knows the operation completed successfully.
 */
function logOperationFinish(logger: GraphqlOperationLogger, state: GraphqlOperationLogRequestState): void {
  ensureOperationStartLogged(logger, state);
  const durationMs = calculateDurationMs(state.startedAt);

  state.terminalLogWritten = true;
  state.span.setStatus({ code: SpanStatusCode.OK });
  state.span.end();

  logger.info(
    'graphql.operation.finish',
    createOperationLogFields(state, {
      duration_ms: durationMs,
      outcome: 'success',
    }),
  );
  recordGraphqlOperationMetrics({
    businessOperation: state.metadata.businessOperation,
    operationType: state.metadata.operationType,
    outcome: 'success',
    durationMs,
  });
}

/**
 * Emits exactly one operation-start log for the request.
 *
 * Failure can occur before the normal start point, so terminal log paths call
 * this defensively to keep start and terminal events paired.
 */
function ensureOperationStartLogged(logger: GraphqlOperationLogger, state: GraphqlOperationLogRequestState): void {
  if (state.operationStartLogged) {
    return;
  }

  state.operationStartLogged = true;
  logger.info('graphql.operation.start', createOperationLogFields(state));
}

/**
 * Builds initial metadata from the authenticated GraphQL context.
 *
 * GraphQL operation details are unknown here, but auth middleware has already
 * attached the actor and provider identity used for logs and metrics.
 */
function createInitialMetadata(context: MovieReservationGraphqlContext): GraphqlOperationLogMetadata {
  return {
    operationName: anonymousOperationName,
    operationType: 'unknown',
    businessOperation: 'unknown',
    movieProviderCode: context.authenticatedUser.movieProviderCode ?? 'unknown',
    userId: context.actor.userId,
  };
}

/**
 * Creates the structured field payload shared by start, success, and failure logs.
 *
 * The caller's fields are applied last so terminal logs can add outcome,
 * duration, and error details without duplicating the common metadata.
 */
function createOperationLogFields(state: GraphqlOperationLogRequestState, fields: LogFields = {}): LogFields {
  return {
    graphql_operation_name: sanitizeLogToken(state.metadata.operationName),
    graphql_operation_type: sanitizeLogToken(state.metadata.operationType),
    business_operation: state.metadata.businessOperation,
    movie_provider_code: sanitizeLogToken(state.metadata.movieProviderCode),
    user_id: sanitizeLogToken(state.metadata.userId),
    ...fields,
  };
}

/**
 * Copies resolved operation metadata onto the manual GraphQL span.
 *
 * Auto-instrumentation creates lower-level spans, while this span gives the
 * project a stable business-oriented grouping for operation-level telemetry.
 */
function annotateSpan(state: GraphqlOperationLogRequestState): void {
  state.span.setAttribute('graphql.operation.name', state.metadata.operationName);
  state.span.setAttribute('graphql.operation.type', state.metadata.operationType);
  state.span.setAttribute('business.operation', state.metadata.businessOperation);
  state.span.setAttribute('movie.provider.code', state.metadata.movieProviderCode);
  state.span.setAttribute('enduser.id', state.metadata.userId);
}

/**
 * Maps the top-level GraphQL field to the bounded business operation name.
 *
 * This keeps metrics low-cardinality by recording known operation groups rather
 * than arbitrary query text or nested selection details.
 */
function resolveBusinessOperation(operation: OperationDefinitionNode | undefined): MovieReservationBusinessOperation {
  const knownOperations = new Set<MovieReservationBusinessOperation>([
    'me',
    'movies',
    'screenings',
    'requestReservation',
    'reservationRequestStatus',
    'reservationResult',
  ]);
  const fieldNames = operation?.selectionSet.selections.flatMap((selection) =>
    selection.kind === Kind.FIELD ? [selection.name.value] : [],
  );
  const firstFieldName = fieldNames?.[0];

  if (firstFieldName !== undefined && knownOperations.has(firstFieldName as MovieReservationBusinessOperation)) {
    return firstFieldName as MovieReservationBusinessOperation;
  }

  return 'unknown';
}

/**
 * Converts GraphQL execution errors into the metric outcome vocabulary.
 *
 * Authentication failures are tracked separately; other GraphQL execution
 * failures are intentionally grouped together for low-cardinality metrics.
 */
function classifyGraphqlOutcome(errors: readonly GraphQLError[]): GraphqlOperationOutcome {
  if (errors.some((error) => getGraphqlErrorType(error) === 'AuthenticationError')) {
    return 'auth_error';
  }

  return errors.length === 0 ? 'graphql_error' : 'graphql_error';
}

/** Converts a high-resolution start timestamp into elapsed milliseconds. */
function calculateDurationMs(startedAt: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
  return Number(elapsedNanoseconds) / 1_000_000;
}

/**
 * Reads GraphQL errors from Apollo's single-result response shape.
 *
 * Incremental or multipart responses are not handled by this service yet, so
 * non-single response bodies are treated as having no inspectable errors here.
 */
function readResponseErrors(response: GraphqlOperationResponse): readonly unknown[] {
  if (response.body.kind !== 'single') {
    return [];
  }

  return response.body.singleResult?.errors ?? [];
}

/** Returns the application error class when Apollo wrapped an original error. */
function getGraphqlErrorType(error: GraphQLError): string {
  return error.originalError?.constructor.name ?? error.constructor.name;
}

/**
 * Normalizes user-controlled tokens before placing them in structured logs.
 *
 * This keeps log fields single-line and avoids characters that commonly break
 * simple log-query filters.
 */
function sanitizeLogToken(value: string): string {
  return value.replaceAll('"', "'").replaceAll('\n', ' ').replaceAll(/\s/g, '_').replaceAll('=', ':');
}
