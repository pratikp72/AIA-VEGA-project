'use strict';

/**
 * Migration: widen gallery_items text-like columns to avoid varchar(255) overflow on publish.
 * - description: varchar(255) -> text
 * - location: varchar(255) -> text
 */

module.exports = {
  async up(knex) {
    const exists = await knex.schema.withSchema('public').hasTable('gallery_items');
    if (!exists) return;

    const q = (sql) => knex.raw(sql);
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "description" TYPE text');
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "location" TYPE text');
  },

  async down(knex) {
    const exists = await knex.schema.withSchema('public').hasTable('gallery_items');
    if (!exists) return;

    const q = (sql) => knex.raw(sql);
    await q('UPDATE "public"."gallery_items" SET "description" = LEFT(COALESCE("description", \'\'), 255)');
    await q('UPDATE "public"."gallery_items" SET "location" = LEFT(COALESCE("location", \'\'), 255)');
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "description" TYPE varchar(255)');
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "location" TYPE varchar(255)');
  },
};
