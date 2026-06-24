import { describe, expect, it } from 'vitest';

import { SeatReservationCommitError } from '../../../src/application/movie-reservations/errors/seat-reservation-commit-error';
import { classifyDiagnosticException } from '../../../src/infrastructure/observability/metrics/diagnostic-exception-classification';

describe('classifyDiagnosticException', () => {
  it('keeps seat reservation commit failures as a bounded diagnostic metric label', () => {
    expect(classifyDiagnosticException(new SeatReservationCommitError())).toBe('SeatReservationCommitError');
  });
});
