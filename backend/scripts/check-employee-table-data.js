'use strict';

/**
 * Diagnostic script: Check if user-progress and quiz-submission data exists for Employee Table.
 * Run: node scripts/check-employee-table-data.js
 */

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  const strapi = app;

  try {
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { blocked: { $eq: false } },
      limit: 5,
    });
    console.log('\n=== Employee Table Data Check ===\n');
    console.log('Users (first 5):', users?.length ?? 0);
    if (users?.length > 0) {
      const u = users[0];
      console.log('  Sample user:', { id: u?.id, documentId: u?.documentId, document_id: u?.document_id, email: u?.email });
    }

    let progressCount = 0;
    try {
      const progresses = await strapi.documents('api::user-progress.user-progress').findMany({
        status: 'published',
        pagination: { limit: 100 },
      });
      progressCount = Array.isArray(progresses) ? progresses.length : 0;
      console.log('\nUser Progress (published):', progressCount);
      if (progresses?.length > 0) {
        const p = progresses[0];
        console.log('  Sample:', { user: p?.user?.id ?? p?.user?.documentId ?? p?.user_id, time_spent: p?.time_spent_minutes });
      }
    } catch (e) {
      console.log('\nUser Progress: ERROR -', e?.message);
      try {
        const raw = await strapi.db.query('api::user-progress.user-progress').findMany({ limit: 100 });
        progressCount = Array.isArray(raw) ? raw.length : 0;
        console.log('  (db.query fallback):', progressCount, 'rows');
        if (raw?.[0]) console.log('  Sample user_id:', raw[0]?.user_id, '(use this for Employee Table matching)');
      } catch (e2) {
        console.log('  Fallback failed:', e2?.message);
      }
    }

    let submissionCount = 0;
    try {
      const subs = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        status: 'published',
        pagination: { limit: 100 },
      });
      submissionCount = Array.isArray(subs) ? subs.length : 0;
      console.log('\nQuiz Submissions (published):', submissionCount);
      if (subs?.[0]) {
        const s = subs[0];
        console.log('  Sample:', { submitted_by: s?.submitted_by?.id ?? s?.submitted_by_id, score: s?.score });
      }
    } catch (e) {
      console.log('\nQuiz Submissions: ERROR -', e?.message);
    }

    if (progressCount === 0 && submissionCount === 0) {
      console.log('\n*** NO DATA: Run "npm run seed:portal" to create user-progress and quiz-submission records. ***\n');
    } else {
      console.log('\nData exists. If Employee Table still shows zeros, check Strapi logs for errors.\n');
    }
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
