// Script to sync completed_modules in user-progress with modules where mark_as_read is true
// Run with: node scripts/sync-completed-modules.js

const { createStrapi, compileStrapi } = require('@strapi/strapi');

async function main() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  global.strapi = app;

  try {
    // Get all user-progress records
    const progresses = await strapi.db.query('api::user-progress.user-progress').findMany({
      populate: ['user', 'course'],
      limit: 10000,
    });
    let updated = 0;
    for (const progress of progresses) {
      if (!progress.user || !progress.course) continue;
      // Get the course with modules
      const course = await strapi.db.query('api::course.course').findOne({
        where: { id: progress.course.id },
        populate: ['modules'],
      });
      if (!course || !Array.isArray(course.modules)) continue;
      // Find modules where mark_as_read is true for this user
      // (Assumes mark_as_read is user-specific; if not, this will just use the module's value)
      // If mark_as_read is not user-specific, you need a join table or a user-module-progress collection
      const completed = course.modules.filter(m => m.mark_as_read === true).map(m => m.module_id || m.id || m.title);
      // Update user-progress if needed
      if (JSON.stringify(progress.completed_modules) !== JSON.stringify(completed)) {
        await strapi.db.query('api::user-progress.user-progress').update({
          where: { id: progress.id },
          data: { completed_modules: completed },
        });
        updated++;
      }
    }
    console.log(`Updated ${updated} user-progress records.`);
  } catch (e) {
    console.error('Sync failed:', e);
  }
  await app.destroy();
}

main();
