import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservation_requests', (table) => {
    table.text('correlation_id');
    table.text('request_id');
    table.text('traceparent');
    table.text('tracestate');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservation_requests', (table) => {
    table.dropColumn('tracestate');
    table.dropColumn('traceparent');
    table.dropColumn('request_id');
    table.dropColumn('correlation_id');
  });
}
