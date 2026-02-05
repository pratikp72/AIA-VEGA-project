'use strict';

/**
 * Quick check: do we have user-progress / quiz-submission / module-video-progress rows?
 * Run: node scripts/check-learning-data.js (from backend dir, with Strapi not running)
 * Or run from Strapi: node -e "require('./scripts/check-learning-data.js')" after loading strapi
 */

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  try {
    const progressCount = await app.db.query('api::user-progress.user-progress').count();
    const submissionCount = await app.db.query('api::quiz-submission.quiz-submission').count();
    let moduleVideoCount = 0;
    try {
      moduleVideoCount = await app.db.query('api::module-video-progress.module-video-progress').count();
    } catch (e) {
      console.warn('module-video-progress count failed:', e?.message);
    }
    console.log('Learning data in DB:');
    console.log('  user_progresses:', progressCount);
    console.log('  quiz_submissions:', submissionCount);
    console.log('  module_video_progress:', moduleVideoCount);
    if (progressCount === 0 && submissionCount === 0) {
      console.log('\nNo learning data. Run: npm run seed:all');
    }
  } catch (e) {
    console.error('Check failed:', e.message);
  }
  await app.destroy();
  process.exit(0);
}

main();
