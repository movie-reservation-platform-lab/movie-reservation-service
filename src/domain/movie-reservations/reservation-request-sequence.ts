declare const reservationRequestSequenceBrand: unique symbol;

/**
 * Internal FIFO ordering value for reservation request processing.
 *
 * The sequence is operational metadata, not public API identity and not a
 * field on the `ReservationRequest` domain model. Should be included in
 * application-owner observability.
 */
export type ReservationRequestSequence = number & {
  readonly [reservationRequestSequenceBrand]: 'ReservationRequestSequence';
};

export function createReservationRequestSequence(
  value: number,
): ReservationRequestSequence {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      'ReservationRequestSequence must be a positive safe integer',
    );
  }

  return value as ReservationRequestSequence;
}
