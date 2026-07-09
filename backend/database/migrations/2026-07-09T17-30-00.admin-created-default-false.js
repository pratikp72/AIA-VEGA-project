'use strict';

/**
 * Migration: set admin_created column default to false and backfill existing nulls.
 *
 * - All historical null rows are treated as frontend-created (false).
 * - Sets the PostgreSQL column DEFAULT so future INSERTs that omit the field
 *   automatically get false instead of null.
 */

module.exports = {
  async up(knex) {
    // 1. Backfill existing null rows to false
    await knex('quiz_reattempt_requests')
      .whereNull('admin_created')
      .update({ admin_created: false });

    // 2. Set column default to false at DB level
    await knex.schema.alterTable('quiz_reattempt_requests', (table) => {
      table.boolean('admin_created').defaultTo(false).alter();
    });
  },

  async down(knex) {
    // Revert column default back to null (no backfill reversal — data loss not recoverable)
    await knex.schema.alterTable('quiz_reattempt_requests', (table) => {
      table.boolean('admin_created').defaultTo(null).alter();
    });
  },
};
