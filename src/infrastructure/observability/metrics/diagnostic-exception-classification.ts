export type DiagnosticExceptionType =
  | 'AuthenticationError'
  | 'ReservationRequestAlreadyExistsError'
  | 'Error'
  | 'unexpected_error';

/**
 * Converts unknown thrown values into bounded diagnostic labels for metrics.
 */
export function classifyDiagnosticException(error: unknown): DiagnosticExceptionType {
  if (!(error instanceof Error)) {
    return 'unexpected_error';
  }

  if (
    error.constructor.name === 'AuthenticationError' ||
    error.constructor.name === 'ReservationRequestAlreadyExistsError' ||
    error.constructor.name === 'Error'
  ) {
    return error.constructor.name;
  }

  return 'unexpected_error';
}
