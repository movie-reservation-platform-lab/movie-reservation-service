import type { Knex } from 'knex';

const reservationRequestStatuses = ['REQUESTED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'FAILED'] as const;

const processingAttemptOutcomes = ['confirmed', 'rejected', 'failed'] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('movie_providers', (table) => {
    table.uuid('id').primary();
    table.text('code').notNullable().unique();
    table.text('name').notNullable();
  });

  await knex.schema.createTable('movies', (table) => {
    table.uuid('id').primary();
    table.uuid('movie_provider_id').notNullable().references('id').inTable('movie_providers');
    table.text('title').notNullable();
    table.text('rating').notNullable();
    table.integer('duration_minutes').notNullable();
    table.unique(['id', 'movie_provider_id']);
    table.index(['movie_provider_id']);
  });

  await knex.schema.createTable('auditoriums', (table) => {
    table.uuid('id').primary();
    table.uuid('movie_provider_id').notNullable().references('id').inTable('movie_providers');
    table.text('name').notNullable();
    table.unique(['id', 'movie_provider_id']);
    table.index(['movie_provider_id']);
  });

  await knex.schema.createTable('screenings', (table) => {
    table.uuid('id').primary();
    table.uuid('movie_provider_id').notNullable().references('id').inTable('movie_providers');
    table.uuid('movie_id').notNullable().references('id').inTable('movies');
    table.uuid('auditorium_id').notNullable().references('id').inTable('auditoriums');
    table.timestamp('starts_at', { useTz: true }).notNullable();
    table.timestamp('ends_at', { useTz: true }).notNullable();
    table.unique(['id', 'movie_provider_id']);
    table.unique(['id', 'movie_provider_id', 'auditorium_id']);
    table.foreign(['movie_id', 'movie_provider_id']).references(['id', 'movie_provider_id']).inTable('movies');
    table
      .foreign(['auditorium_id', 'movie_provider_id'])
      .references(['id', 'movie_provider_id'])
      .inTable('auditoriums');
    table.index(['movie_provider_id']);
    table.index(['movie_id']);
    table.index(['auditorium_id']);
  });

  await knex.schema.createTable('seats', (table) => {
    table.uuid('id').primary();
    table.uuid('movie_provider_id').notNullable().references('id').inTable('movie_providers');
    table.uuid('auditorium_id').notNullable().references('id').inTable('auditoriums');
    table.text('row_label').notNullable();
    table.integer('seat_number').notNullable();
    table.unique(['auditorium_id', 'row_label', 'seat_number']);
    table.unique(['id', 'movie_provider_id']);
    table.unique(['id', 'movie_provider_id', 'auditorium_id']);
    table
      .foreign(['auditorium_id', 'movie_provider_id'])
      .references(['id', 'movie_provider_id'])
      .inTable('auditoriums');
    table.index(['movie_provider_id']);
    table.index(['auditorium_id']);
  });

  await knex.schema.createTable('reservation_requests', (table) => {
    table.uuid('id').primary();
    table.specificType('sequence', 'bigint generated always as identity');
    table.uuid('movie_provider_id').notNullable().references('id').inTable('movie_providers');
    table.uuid('screening_id').notNullable().references('id').inTable('screenings');
    table.text('requested_by_user_id').notNullable();
    table.text('status').notNullable();
    table.timestamp('requested_at', { useTz: true }).notNullable();
    table.text('claimed_by');
    table.text('claim_token');
    table.timestamp('claimed_at', { useTz: true });
    table.timestamp('claim_expires_at', { useTz: true });
    table.timestamp('last_heartbeat_at', { useTz: true });
    table.integer('lease_timeout_count').notNullable().defaultTo(0);
    table.integer('transient_failure_count').notNullable().defaultTo(0);
    table.timestamp('processed_at', { useTz: true });
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.unique(['sequence']);
    table.unique(['id', 'movie_provider_id', 'screening_id']);
    table.foreign(['screening_id', 'movie_provider_id']).references(['id', 'movie_provider_id']).inTable('screenings');
    table.index(['movie_provider_id']);
    table.index(['status', 'sequence']);
    table.index(['status', 'claim_expires_at', 'sequence']);
    table.index(['lease_timeout_count']);
    table.index(['transient_failure_count']);
    table.index(['requested_by_user_id']);
    table.index(['screening_id']);
  });
  await addTextEnumConstraint(
    knex,
    'reservation_requests',
    'status',
    'reservation_requests_status_check',
    reservationRequestStatuses,
  );

  await knex.schema.createTable('reservation_request_seats', (table) => {
    table.uuid('reservation_request_id').notNullable();
    table.uuid('movie_provider_id').notNullable();
    table.uuid('screening_id').notNullable();
    table.uuid('auditorium_id').notNullable();
    table.uuid('seat_id').notNullable();
    table.primary(['reservation_request_id', 'seat_id']);
    table
      .foreign(['reservation_request_id', 'movie_provider_id', 'screening_id'])
      .references(['id', 'movie_provider_id', 'screening_id'])
      .inTable('reservation_requests')
      .onDelete('CASCADE');
    table
      .foreign(['screening_id', 'movie_provider_id', 'auditorium_id'])
      .references(['id', 'movie_provider_id', 'auditorium_id'])
      .inTable('screenings');
    table
      .foreign(['seat_id', 'movie_provider_id', 'auditorium_id'])
      .references(['id', 'movie_provider_id', 'auditorium_id'])
      .inTable('seats');
    table.index(['movie_provider_id']);
    table.index(['screening_id']);
    table.index(['seat_id']);
  });

  await knex.schema.createTable('reservations', (table) => {
    table.uuid('id').primary();
    table.uuid('movie_provider_id').notNullable().references('id').inTable('movie_providers');
    table.uuid('reservation_request_id').notNullable().unique().references('id').inTable('reservation_requests');
    table.uuid('screening_id').notNullable().references('id').inTable('screenings');
    table.text('reserved_by_user_id').notNullable();
    table.timestamp('confirmed_at', { useTz: true }).notNullable();
    table.foreign(['screening_id', 'movie_provider_id']).references(['id', 'movie_provider_id']).inTable('screenings');
    table
      .foreign(['reservation_request_id', 'movie_provider_id', 'screening_id'])
      .references(['id', 'movie_provider_id', 'screening_id'])
      .inTable('reservation_requests');
    table.unique(['id', 'movie_provider_id', 'screening_id']);
    table.index(['movie_provider_id']);
    table.index(['screening_id']);
  });

  await knex.schema.createTable('reservation_seats', (table) => {
    table.uuid('reservation_id').notNullable();
    table.uuid('movie_provider_id').notNullable();
    table.uuid('screening_id').notNullable();
    table.uuid('auditorium_id').notNullable();
    table.uuid('seat_id').notNullable();
    table.primary(['reservation_id', 'seat_id']);
    table
      .foreign(['reservation_id', 'movie_provider_id', 'screening_id'])
      .references(['id', 'movie_provider_id', 'screening_id'])
      .inTable('reservations')
      .onDelete('CASCADE');
    table
      .foreign(['screening_id', 'movie_provider_id', 'auditorium_id'])
      .references(['id', 'movie_provider_id', 'auditorium_id'])
      .inTable('screenings');
    table
      .foreign(['seat_id', 'movie_provider_id', 'auditorium_id'])
      .references(['id', 'movie_provider_id', 'auditorium_id'])
      .inTable('seats');
    table.unique(['screening_id', 'seat_id'], {
      indexName: 'reservation_seats_screening_id_seat_id_unique',
    });
    table.index(['movie_provider_id']);
    table.index(['seat_id']);
  });

  await knex.schema.createTable('reservation_request_processing_attempts', (table) => {
    table.bigIncrements('id').primary();
    table
      .uuid('reservation_request_id')
      .notNullable()
      .references('id')
      .inTable('reservation_requests')
      .onDelete('CASCADE');
    table.bigInteger('reservation_request_sequence').notNullable();
    table.timestamp('started_at', { useTz: true }).notNullable();
    table.timestamp('completed_at', { useTz: true }).notNullable();
    table.text('outcome').notNullable();
    table.text('reason');
    table.uuid('reservation_id').references('id').inTable('reservations');
    table.uuid('conflicting_reservation_id').references('id').inTable('reservations');
    table.index(['reservation_request_id']);
    table.index(['outcome']);
  });
  await addTextEnumConstraint(
    knex,
    'reservation_request_processing_attempts',
    'outcome',
    'reservation_request_processing_attempts_outcome_check',
    processingAttemptOutcomes,
  );
  await knex.raw(`
    alter table reservation_request_processing_attempts
    add constraint reservation_request_processing_attempts_shape_check
    check (
      (
        outcome = 'confirmed'
        and reservation_id is not null
        and reason is null
        and conflicting_reservation_id is null
      )
      or (
        outcome = 'rejected'
        and reason = 'seat-conflict'
        and reservation_id is null
        and conflicting_reservation_id is not null
      )
      or (
        outcome = 'failed'
        and reason in ('unexpected-error', 'lease-timeout')
        and reservation_id is null
        and conflicting_reservation_id is null
      )
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('reservation_request_processing_attempts');
  await knex.schema.dropTableIfExists('reservation_seats');
  await knex.schema.dropTableIfExists('reservations');
  await knex.schema.dropTableIfExists('reservation_request_seats');
  await knex.schema.dropTableIfExists('reservation_requests');
  await knex.schema.dropTableIfExists('seats');
  await knex.schema.dropTableIfExists('screenings');
  await knex.schema.dropTableIfExists('auditoriums');
  await knex.schema.dropTableIfExists('movies');
  await knex.schema.dropTableIfExists('movie_providers');
}

async function addTextEnumConstraint(
  knex: Knex,
  tableName: string,
  columnName: string,
  constraintName: string,
  allowedValues: readonly string[],
): Promise<void> {
  const quotedValues = allowedValues.map((value) => knex.raw('?', [value]).toQuery()).join(', ');

  await knex.raw(`
    alter table ${tableName}
    add constraint ${constraintName}
    check (${columnName} in (${quotedValues}))
  `);
}
