'use strict';

/**
 * Migration: Activity Log schema updates
 * - company: enum -> relation (manyToOne to api::company.company)
 * - Rename Event_Registration to Event_Info in activity_type
 */
module.exports = {
  async up(knex) {
    const tableName = 'activity_logs';
    const companiesTable = 'companies';

    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) return;

    const hasCompanyStr = await knex.schema.hasColumn(tableName, 'company');
    const hasCompanyId = await knex.schema.hasColumn(tableName, 'company_id');

    // Add company_id if missing (for relation to companies table)
    if (!hasCompanyId && (await knex.schema.hasTable(companiesTable))) {
      await knex.schema.alterTable(tableName, (table) => {
        table.integer('company_id').unsigned().nullable().references('id').inTable(companiesTable);
      });
    }

    // Migrate existing company (string) to company_id (relation)
    if (hasCompanyStr && (await knex.schema.hasTable(companiesTable))) {
      const companies = await knex(companiesTable).select('id', 'name');
      const byName = {};
      companies.forEach((c) => { byName[(c.name || '').toUpperCase()] = c.id; });

      const rows = await knex(tableName).select('id', 'company').whereNotNull('company');
      for (const row of rows) {
        const companyId = byName[(row.company || '').toUpperCase()] || null;
        await knex(tableName).where('id', row.id).update({ company_id: companyId });
      }
      await knex.schema.alterTable(tableName, (table) => table.dropColumn('company'));
    }

    await knex(tableName).where('activity_type', 'Event_Registration').update({ activity_type: 'Event_Info' });
  },

  async down(knex) {
    const tableName = 'activity_logs';
    const hasTable = await knex.schema.hasTable(tableName);
    if (hasTable) {
      const hasCompanyId = await knex.schema.hasColumn(tableName, 'company_id');
      if (hasCompanyId) {
        await knex.schema.alterTable(tableName, (table) => {
          table.dropForeign(['company_id']);
          table.dropColumn('company_id');
        });
      }
      await knex(tableName).where('activity_type', 'Event_Info').update({ activity_type: 'Event_Registration' });
    }
  },
};
