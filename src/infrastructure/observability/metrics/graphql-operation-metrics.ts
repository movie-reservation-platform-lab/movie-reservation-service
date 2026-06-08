import type { MovieReservationBusinessOperation } from '../../../application/movie-reservations/ports/movie-reservation-observability';
import type { DiagnosticExceptionType } from './diagnostic-exception-classification';
import { serviceMeter } from './otel-meter';

export type GraphqlOperationOutcome = 'success' | 'graphql_error' | 'auth_error' | 'unexpected_error';

const graphqlOperationTotal = serviceMeter.createCounter('graphql_operation_total', {
  description: 'GraphQL operations by bounded business operation and outcome.',
});
const graphqlOperationDurationMs = serviceMeter.createHistogram('graphql_operation_duration_ms', {
  description: 'GraphQL operation duration in milliseconds.',
  unit: 'ms',
});
const graphqlOperationExceptionsTotal = serviceMeter.createCounter('graphql_operation_exceptions_total', {
  description: 'GraphQL diagnostic exception counts with bounded exception labels.',
});

const graphqlBusinessOperations: readonly MovieReservationBusinessOperation[] = [
  'me',
  'movies',
  'screenings',
  'requestReservation',
  'reservationRequestStatus',
  'reservationResult',
  'unknown',
];
const graphqlOperationOutcomes: readonly GraphqlOperationOutcome[] = [
  'success',
  'graphql_error',
  'auth_error',
  'unexpected_error',
];

/**
 * Pre-creates bounded GraphQL operation metric series for local dashboards.
 *
 * For more information, see: https://prometheus.io/docs/practices/instrumentation/#avoid-missing-metrics
 */
export function initializeGraphqlOperationMetricSeries(): void {
  for (const businessOperation of graphqlBusinessOperations) {
    for (const outcome of graphqlOperationOutcomes) {
      graphqlOperationTotal.add(0, { business_operation: businessOperation, outcome });
    }
  }
}

/**
 * Records one completed GraphQL operation counter and duration sample.
 */
export function recordGraphqlOperationMetrics(input: {
  readonly businessOperation: MovieReservationBusinessOperation;
  readonly operationType: string;
  readonly outcome: GraphqlOperationOutcome;
  readonly durationMs: number;
}): void {
  const attributes = {
    business_operation: input.businessOperation,
    graphql_operation_type: input.operationType,
    outcome: input.outcome,
  };

  graphqlOperationTotal.add(1, attributes);
  graphqlOperationDurationMs.record(input.durationMs, attributes);
}

/**
 * Increments the bounded GraphQL diagnostic exception counter.
 */
export function incrementGraphqlExceptionCount(input: {
  readonly businessOperation: MovieReservationBusinessOperation;
  readonly exceptionType: DiagnosticExceptionType;
}): void {
  graphqlOperationExceptionsTotal.add(1, {
    business_operation: input.businessOperation,
    exception_type: input.exceptionType,
  });
}
