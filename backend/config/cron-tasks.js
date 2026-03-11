'use strict';

/**
 * Strapi cron tasks configuration.
 *
 * Each key is a cron expression (or an object with { rule, options }).
 * The task function receives the Strapi instance via `{ strapi }`.
 *
 * Docs: https://docs.strapi.io/dev-docs/configurations/cron
 */

const { syncUsers } = require('../src/cron/sync-users');

module.exports = {
  // Sync users from the external HR API every 10 minutes.
  // Cron expression: every-10-min  →  "*/10 * * * *"
  //   (minute 0, 10, 20, 30, 40, 50 of every hour)
  '*/10 * * * *': {
    task: async ({ strapi }) => {
      try {
        await syncUsers(strapi);
      } catch (err) {
        strapi.log.error('[cron] sync-users task threw an unhandled error:', err?.message || err);
      }
    },
    options: {
      tz: 'UTC',
    },
  },
};
