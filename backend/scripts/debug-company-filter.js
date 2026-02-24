'use strict';

/**
 * Debug script for Learning Analytics company filter.
 * Run: node scripts/debug-company-filter.js (from backend dir, with Strapi NOT running)
 *
 * Checks:
 * 1. Users with company AIA/Vega
 * 2. User-progress records and their linked users
 * 3. Whether user-progress users have company set
 */
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  try {
    console.log('\n=== Company Filter Debug ===\n');

    // 1. Users by company
    const usersAIA = await app.db.query('plugin::users-permissions.user').findMany({
      where: { company: 'AIA', blocked: { $ne: true } },
      select: ['id', 'username', 'email', 'company'],
    });
    const usersVega = await app.db.query('plugin::users-permissions.user').findMany({
      where: { company: 'Vega', blocked: { $ne: true } },
      select: ['id', 'username', 'email', 'company'],
    });
    const usersNoCompany = await app.db.query('plugin::users-permissions.user').findMany({
      where: { $or: [{ company: null }, { company: '' }], blocked: { $ne: true } },
      select: ['id', 'username', 'email', 'company'],
      limit: 5,
    });

    console.log('1. Users by company:');
    console.log('   AIA:', usersAIA?.length ?? 0, 'users');
    if (usersAIA?.length > 0) {
      console.log('   Sample AIA user:', JSON.stringify(usersAIA[0]));
    }
    console.log('   Vega:', usersVega?.length ?? 0, 'users');
    if (usersVega?.length > 0) {
      console.log('   Sample Vega user:', JSON.stringify(usersVega[0]));
    }
    console.log('   No company (null/empty):', usersNoCompany?.length ?? 0, '(showing up to 5)');
    if (usersNoCompany?.length > 0) {
      console.log('   Sample:', JSON.stringify(usersNoCompany[0]));
    }

    // 2. User-progress count
    const progressCount = await app.db.query('api::user-progress.user-progress').count();
    console.log('\n2. User-progress records:', progressCount);

    // 3. Sample user-progress with user populated - check if user has company
    const sampleProgress = await app.db.query('api::user-progress.user-progress').findMany({
      limit: 5,
      populate: { user: true, course: true },
    });
    console.log('\n3. Sample user-progress (first 5):');
    for (const p of sampleProgress || []) {
      const uid = p.user_id ?? p.user?.id;
      const u = p.user;
      const company = u?.company ?? '(no user or company)';
      console.log('   progress id:', p.id, '| user_id:', uid, '| user.company:', company);
    }

    // 4. User-progress for AIA users specifically
    const aiUserIds = (usersAIA || []).map((u) => u.id).filter(Boolean);
    if (aiUserIds.length > 0) {
      const progressAIA = await app.db.query('api::user-progress.user-progress').findMany({
        where: { user_id: { $in: aiUserIds } },
        limit: 10,
      });
      const progressAIAUser = await app.db.query('api::user-progress.user-progress').findMany({
        where: { user: { id: { $in: aiUserIds } } },
        limit: 10,
      });
      console.log('\n4. User-progress for AIA users:');
      console.log('   Using user_id filter:', progressAIA?.length ?? 0, 'records');
      console.log('   Using user.id filter:', progressAIAUser?.length ?? 0, 'records');
    }

    console.log('\n=== End Debug ===\n');
  } catch (e) {
    console.error('Debug failed:', e?.message || e);
  }
  await app.destroy();
  process.exit(0);
}

main();
