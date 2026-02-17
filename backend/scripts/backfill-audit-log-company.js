// Script to backfill the company field in audit log entries
// Run with: node scripts/backfill-audit-log-company.js

const { createStrapi } = require('@strapi/strapi');

async function main() {
  const strapi = await createStrapi();
  await strapi.start();

  const entries = await strapi.db.query('plugin::audit-log.audit-entry').findMany({
    where: { company: null },
    limit: 1000, // adjust as needed
  });

  let updated = 0;
  for (const entry of entries) {
    const snapshot = entry.snapshot || {};
    if (snapshot.company) {
      await strapi.db.query('plugin::audit-log.audit-entry').update({
        where: { id: entry.id },
        data: { company: snapshot.company },
      });
      updated++;
    }
  }

  console.log(`Updated ${updated} audit log entries with company field.`);
  await strapi.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
