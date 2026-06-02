import type { ApolloServerPlugin } from '@apollo/server';
import { Logger } from '@nestjs/common';
import type { GraphQLError, OperationTypeNode } from 'graphql';

import type { MovieReservationGraphqlContext } from '../graphql-context';

export interface GraphqlOperationLogger {
  log(message: string): void;
  error(message: string, trace?: string): void;
}

interface GraphqlOperationLogMetadata {
  readonly operationName: string;
  readonly operationType: OperationTypeNode | 'unknown';
  readonly movieProviderCode: string;
  readonly userId: string;
}

interface GraphqlOperationLogRequestState {
  readonly startedAt: bigint;
  metadata: GraphqlOperationLogMetadata;
  operationStartLogged: boolean;
}

interface ScrubbedGraphqlErrorForLog {
  readonly type: string;
  readonly message: string;
}

interface GraphqlOperationResponse {
  readonly body: {
    readonly kind: string;
    readonly singleResult?: {
      readonly errors?: readonly unknown[];
    };
  };
}

const anonymousOperationName = 'anonymous';

/**
 * Apollo plugin for one-line GraphQL operation lifecycle logs.
 *
 * This lives at the GraphQL boundary instead of inside resolvers so one log
 * pair covers every operation consistently, including operations that return
 * GraphQL errors. The nested callbacks follow Apollo's plugin lifecycle API;
 * the logging decisions are delegated to named helpers below.
 *
 * For more information, see:
 * - https://www.apollographql.com/docs/apollo-server/integrations/plugins
 * - https://docs.nestjs.com/graphql/plugins
 */
export function createGraphqlOperationLoggingPlugin(
  logger: GraphqlOperationLogger = new Logger('GraphQLOperation'),
): ApolloServerPlugin<MovieReservationGraphqlContext> {
  return {
    async requestDidStart(requestContext) {
      const state = createRequestLogState(requestContext.contextValue);

      return {
        async didResolveOperation(resolvedOperationContext) {
          logResolvedOperation(logger, state, {
            operationName: resolvedOperationContext.operationName,
            operationType: resolvedOperationContext.operation?.operation,
          });
        },

        async didEncounterErrors(errorContext) {
          logOperationFailure(logger, state, errorContext.errors);
        },

        async willSendResponse(responseContext) {
          logOperationFinish(logger, state, responseContext.response);
        },
      };
    },

    async contextCreationDidFail({ error }) {
      logContextCreationFailure(logger, error);
    },

    async unexpectedErrorProcessingRequest({ error }) {
      logUnexpectedRequestProcessingError(logger, error);
    },
  };
}

/**
 * Per-request logging state is initialized before Apollo has resolved the
 * operation name and operation type.
 */
function createRequestLogState(context: MovieReservationGraphqlContext): GraphqlOperationLogRequestState {
  return {
    startedAt: process.hrtime.bigint(),
    metadata: createInitialMetadata(context),
    operationStartLogged: false,
  };
}

/**
 * The start log is emitted after Apollo has resolved operation metadata.
 */
function logResolvedOperation(
  logger: GraphqlOperationLogger,
  state: GraphqlOperationLogRequestState,
  operation: {
    readonly operationName: string | null | undefined;
    readonly operationType: OperationTypeNode | undefined;
  },
): void {
  state.metadata = {
    ...state.metadata,
    operationName: operation.operationName ?? anonymousOperationName,
    operationType: operation.operationType ?? 'unknown',
  };
  ensureOperationStartLogged(logger, state);
}

/**
 * Failure logs include scrubbed GraphQL errors and any available stack traces.
 */
function logOperationFailure(
  logger: GraphqlOperationLogger,
  state: GraphqlOperationLogRequestState,
  errors: readonly GraphQLError[],
): void {
  ensureOperationStartLogged(logger, state);

  logger.error(
    formatOperationLog('graphql.operation.failure', state.metadata, {
      durationMs: calculateDurationMs(state.startedAt),
      errorCount: errors.length,
      errors: errors.map(scrubGraphqlErrorForLog),
    }),
    createErrorTrace(errors),
  );
}

/**
 * Finish logs are skipped when the response already carries GraphQL errors.
 */
function logOperationFinish(
  logger: GraphqlOperationLogger,
  state: GraphqlOperationLogRequestState,
  response: GraphqlOperationResponse,
): void {
  if (readResponseErrors(response).length > 0) {
    return;
  }

  ensureOperationStartLogged(logger, state);

  logger.log(
    formatOperationLog('graphql.operation.finish', state.metadata, {
      durationMs: calculateDurationMs(state.startedAt),
    }),
  );
}

/**
 * A synthetic start log is emitted when Apollo fails before operation metadata
 * has been resolved.
 */
function ensureOperationStartLogged(logger: GraphqlOperationLogger, state: GraphqlOperationLogRequestState): void {
  if (state.operationStartLogged) {
    return;
  }

  state.operationStartLogged = true;
  logger.log(formatOperationLog('graphql.operation.start', state.metadata));
}

/**
 * Context failures are logged separately because no authenticated actor may be
 * available yet.
 */
function logContextCreationFailure(logger: GraphqlOperationLogger, error: Error): void {
  logger.error(`event=graphql.context.failure error="${sanitizeLogValue(error.message)}"`, error.stack);
}

/**
 * Unexpected Apollo request-processing failures are logged outside the normal
 * operation lifecycle.
 */
function logUnexpectedRequestProcessingError(logger: GraphqlOperationLogger, error: Error): void {
  logger.error(`event=graphql.operation.unexpected_error error="${sanitizeLogValue(error.message)}"`, error.stack);
}

/**
 * Metadata available from the authenticated GraphQL context is captured first.
 */
function createInitialMetadata(context: MovieReservationGraphqlContext): GraphqlOperationLogMetadata {
  return {
    operationName: anonymousOperationName,
    operationType: 'unknown',
    movieProviderCode: context.authenticatedUser.movieProviderCode ?? 'unknown',
    userId: context.actor.userId,
  };
}

/**
 * A compact key-value log line is built for ingestion by plain log collectors.
 */
function formatOperationLog(
  eventName: string,
  metadata: GraphqlOperationLogMetadata,
  outcome?: {
    readonly durationMs: number;
    readonly errorCount?: number;
    readonly errors?: readonly ScrubbedGraphqlErrorForLog[];
  },
): string {
  const parts = [
    `event=${eventName}`,
    `operationName=${sanitizeLogToken(metadata.operationName)}`,
    `operationType=${sanitizeLogToken(metadata.operationType)}`,
    `movieProviderCode=${sanitizeLogToken(metadata.movieProviderCode)}`,
    `userId=${sanitizeLogToken(metadata.userId)}`,
  ];

  if (outcome !== undefined) {
    parts.push(`durationMs=${outcome.durationMs.toFixed(2)}`);
  }

  if (outcome?.errorCount !== undefined) {
    parts.push(`errorCount=${outcome.errorCount.toString()}`);
  }

  if (outcome?.errors !== undefined) {
    parts.push(`errorTypes="${sanitizeLogValue(outcome.errors.map((error) => error.type).join(' | '))}"`);
    parts.push(`errors="${sanitizeLogValue(outcome.errors.map((error) => error.message).join(' | '))}"`);
  }

  return parts.join(' ');
}

/**
 * Monotonic elapsed time is calculated without relying on wall-clock time.
 */
function calculateDurationMs(startedAt: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
  return Number(elapsedNanoseconds) / 1_000_000;
}

/**
 * GraphQL errors are read from single-result responses only.
 */
function readResponseErrors(response: GraphqlOperationResponse): readonly unknown[] {
  if (response.body.kind !== 'single') {
    return [];
  }

  return response.body.singleResult?.errors ?? [];
}

/**
 * Available GraphQL and wrapped original-error stack traces are joined.
 */
function createErrorTrace(errors: readonly GraphQLError[]): string | undefined {
  const stackTraces = errors.flatMap((error) => {
    if (error.stack !== undefined) {
      return [error.stack];
    }

    const originalStack = error.originalError?.stack;
    return originalStack === undefined ? [] : [originalStack];
  });

  return stackTraces.length === 0 ? undefined : stackTraces.join('\n');
}

/**
 * Error details are reduced to the fields intended for operation logs.
 */
function scrubGraphqlErrorForLog(error: GraphQLError): ScrubbedGraphqlErrorForLog {
  return {
    type: getGraphqlErrorType(error),
    // TODO: Replace this placeholder with production-safe message scrubbing
    // before untrusted input or downstream errors can include sensitive values.
    message: error.message,
  };
}

/**
 * The original application error type is preferred when GraphQL wraps it.
 */
function getGraphqlErrorType(error: GraphQLError): string {
  return error.originalError?.constructor.name ?? error.constructor.name;
}

/**
 * Log values are kept on one line and quoted safely for the current format.
 */
function sanitizeLogValue(value: string): string {
  return value.replaceAll('"', "'").replaceAll('\n', ' ');
}

function sanitizeLogToken(value: string): string {
  return sanitizeLogValue(value).replaceAll(/\s/g, '_').replaceAll('=', ':');
}
