import knexFactory, { type Knex } from 'knex';

import { config } from '../../config';
import {
  createMovieReservationDemoData,
  type MovieReservationDemoData,
  MOVIE_RESERVATION_DEMO_IDS,
} from '../fixtures/movie-reservations/movie-reservation-demo-data';
import {
  createKnexConfig,
  createPostgresConnectionSettings,
} from './knex-config';

/**
 * Writes the shared movie-reservation demo catalog into Postgres.
 *
 * The seed is intentionally idempotent: catalog rows are upserted by primary
 * key and join rows are ignored when already present, so local developers and
 * e2e tests can run it repeatedly against the same database.
 */
export async function seedLocalMovieReservationCatalog(
  database: Knex,
): Promise<void> {
  const demoData = createMovieReservationDemoData();
  const requestedAt = '2026-05-29T00:00:00.000Z';

  await database.transaction(async (trx) => {
    await trx('movie_providers')
      .insert(
        demoData.movieProviders.map((provider) => ({
          id: provider.id,
          code: provider.code,
          name: provider.name,
        })),
      )
      .onConflict('id')
      .merge();

    await trx('auditoriums')
      .insert(
        demoData.auditoriums.map((auditorium) => ({
          id: auditorium.id,
          movie_provider_id: auditorium.movieProviderId,
          name: auditorium.name,
        })),
      )
      .onConflict('id')
      .merge();

    await trx('movies')
      .insert(
        demoData.movies.map((movie) => ({
          id: movie.id,
          movie_provider_id: movie.movieProviderId,
          title: movie.title,
          rating: movie.rating,
          duration_minutes: movie.durationMinutes,
        })),
      )
      .onConflict('id')
      .merge();

    await trx('screenings')
      .insert(
        demoData.screenings.map((screening) => ({
          id: screening.id,
          movie_provider_id: screening.movieProviderId,
          movie_id: screening.movieId,
          auditorium_id: screening.auditoriumId,
          starts_at: screening.startsAt,
          ends_at: screening.endsAt,
        })),
      )
      .onConflict('id')
      .merge();

    await trx('seats')
      .insert(
        demoData.seats.map((seat) => ({
          id: seat.id,
          movie_provider_id: seat.movieProviderId,
          auditorium_id: seat.auditoriumId,
          row_label: seat.row,
          seat_number: seat.number,
        })),
      )
      .onConflict('id')
      .merge();

    await trx('reservation_requests')
      .insert(
        demoData.reservationRequests.map((reservationRequest) => ({
          id: reservationRequest.id,
          movie_provider_id: reservationRequest.movieProviderId,
          screening_id: reservationRequest.screeningId,
          requested_by_user_id: reservationRequest.requestedByUserId,
          status: reservationRequest.status,
          requested_at: requestedAt,
          claimed_by: null,
          claim_token: null,
          claimed_at: null,
          claim_expires_at: null,
          last_heartbeat_at: null,
          lease_timeout_count: 0,
          transient_failure_count: 0,
          processed_at: requestedAt,
          updated_at: requestedAt,
        })),
      )
      .onConflict('id')
      .merge([
        'movie_provider_id',
        'screening_id',
        'requested_by_user_id',
        'status',
        'requested_at',
        'claimed_by',
        'claim_token',
        'claimed_at',
        'claim_expires_at',
        'last_heartbeat_at',
        'lease_timeout_count',
        'transient_failure_count',
        'processed_at',
        'updated_at',
      ]);

    await trx('reservation_request_seats')
      .insert(
        demoData.reservationRequests.flatMap((reservationRequest) => {
          // The join table stores the screening/auditorium context so Postgres
          // can enforce that selected seats belong to the requested screening.
          const auditoriumId = requireSeedScreeningAuditoriumId(
            demoData,
            reservationRequest.screeningId,
          );

          return reservationRequest.seatIds.map((seatId) => ({
            reservation_request_id: reservationRequest.id,
            movie_provider_id: reservationRequest.movieProviderId,
            screening_id: reservationRequest.screeningId,
            auditorium_id: auditoriumId,
            seat_id: seatId,
          }));
        }),
      )
      .onConflict(['reservation_request_id', 'seat_id'])
      .ignore();

    await trx('reservations')
      .insert(
        demoData.reservations.map((reservation) => ({
          id: reservation.id,
          movie_provider_id: reservation.movieProviderId,
          reservation_request_id: reservation.reservationRequestId,
          screening_id: reservation.screeningId,
          reserved_by_user_id: reservation.reservedByUserId,
          confirmed_at: reservation.confirmedAt,
        })),
      )
      .onConflict('id')
      .merge();

    await trx('reservation_seats')
      .insert(
        demoData.reservations.flatMap((reservation) => {
          // Confirmed reservations repeat the same context for the same reason:
          // database constraints reject seats from a different auditorium.
          const auditoriumId = requireSeedScreeningAuditoriumId(
            demoData,
            reservation.screeningId,
          );

          return reservation.seatIds.map((seatId) => ({
            reservation_id: reservation.id,
            movie_provider_id: reservation.movieProviderId,
            screening_id: reservation.screeningId,
            auditorium_id: auditoriumId,
            seat_id: seatId,
          }));
        }),
      )
      .onConflict(['reservation_id', 'seat_id'])
      .ignore();
  });
}

export async function runLocalSeed(): Promise<void> {
  const database = knexFactory(
    createKnexConfig(createPostgresConnectionSettings(config)),
  );

  try {
    await seedLocalMovieReservationCatalog(database);
    console.log(
      `Seeded local movie reservation catalog for provider=${MOVIE_RESERVATION_DEMO_IDS.providerCodes.aurora}`,
    );
  } finally {
    await database.destroy();
  }
}

/**
 * CLI entrypoint used by `npm run db:seed:local-postgres`.
 *
 * The exported seed function accepts a Knex instance so e2e tests can reuse the
 * same deterministic catalog inside their own database lifecycle.
 */
if (require.main === module) {
  void runLocalSeed().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

function requireSeedScreeningAuditoriumId(
  demoData: MovieReservationDemoData,
  screeningId: string,
): string {
  const screening = demoData.screenings.find(
    (candidate) => candidate.id === screeningId,
  );

  if (screening === undefined) {
    throw new Error(`Seed screening ${screeningId} was not found`);
  }

  return screening.auditoriumId;
}
