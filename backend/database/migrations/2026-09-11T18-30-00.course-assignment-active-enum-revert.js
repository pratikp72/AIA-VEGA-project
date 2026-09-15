'use strict';

/**
 * Revert course_assignments.active values after a partial rename was rolled back in code:
 *   active   -> published
 *   unactive -> unpublished
 *
 * Schema is back to published/unpublished; this restores matching DB values.
 * Only course_assignments is updated.
 */

const TABLE = 'course_assignments';

module.exports = {
  async up(knex) {
    const hasTable = await knex.schema.hasTable(TABLE);
    if (!hasTable) {
      console.log(`[migration] Table "${TABLE}" not found, skipping.`);
      return;
    }

    const hasColumn = await knex.schema.hasColumn(TABLE, 'active');
    if (!hasColumn) {
      console.log(`[migration] Column "active" not found in "${TABLE}", skipping.`);
      return;
    }

    console.log(`[migration] Reverting "${TABLE}".active active/unactive → published/unpublished`);

    const toPublished = await knex(TABLE).where({ active: 'active' }).update({ active: 'published' });
    const toUnpublished = await knex(TABLE).where({ active: 'unactive' }).update({ active: 'unpublished' });

    console.log(
      `[migration] "${TABLE}".active updated: ${toPublished} → published, ${toUnpublished} → unpublished`
    );
  },

  async down(knex) {
    const hasTable = await knex.schema.hasTable(TABLE);
    if (!hasTable) return;

    const hasColumn = await knex.schema.hasColumn(TABLE, 'active');
    if (!hasColumn) return;

    console.log(`[migration] Re-applying "${TABLE}".active published/unpublished → active/unactive`);

    await knex(TABLE).where({ active: 'published' }).update({ active: 'active' });
    await knex(TABLE).where({ active: 'unpublished' }).update({ active: 'unactive' });
  },
};
