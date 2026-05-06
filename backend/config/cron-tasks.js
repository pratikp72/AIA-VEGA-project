// @ts-nocheck
'use strict';

const { syncEmployeesFromHrms } = require('../src/cron-tasks/sync-employees');
const { syncVegaEmployees } = require('../src/cron-tasks/sync-vega-employees');
const { syncAiaEmployeePhotos } = require('../src/cron-tasks/sync-aia-employee-photos');

const CRON_TZ = process.env.CRON_TZ || process.env.TZ || 'UTC';
const CRON_DEBUG_EVERY_MINUTE = String(process.env.CRON_DEBUG_EVERY_MINUTE || '').trim().toLowerCase() === 'true';

console.log(
  `[cron-config] loaded: CRON_ENABLED=${process.env.CRON_ENABLED ?? 'unset'} TZ=${process.env.TZ ?? 'unset'} CRON_TZ=${process.env.CRON_TZ ?? 'unset'} effective_tz=${CRON_TZ} debug_every_minute=${CRON_DEBUG_EVERY_MINUTE}`
);

module.exports = {
  // AIA employees — fetched from HRMS API, followed immediately by photo sync
  employeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncEmployeesFromHrms(strapi);
      await syncAiaEmployeePhotos(strapi);
    },
    options: {
      rule: '0 0 18 * * *',
      tz: CRON_TZ,
    },
  },

  // Vega employees — fetched from OneDrive Excel via MS Graph
  vegaEmployeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncVegaEmployees(strapi);
    },
    options: {
      rule: '0 0 18 * * *',
      tz: CRON_TZ,
    },
  },

  ...(CRON_DEBUG_EVERY_MINUTE
    ? {
        cronDebugEveryMinute: {
          task: async ({ strapi }) => {
            strapi.log.info(`[cron-debug] tick at ${new Date().toISOString()} (tz=${CRON_TZ})`);
          },
          options: {
            rule: '0 * * * * *',
            tz: CRON_TZ,
          },
        },
      }
    : {}),

//   // AIA employee photos — synced from mounted NFS share at /mnt/empimages
//   // Runs once daily at 2 PM. Only updates users that don't yet have a photo.
//   aiaEmployeePhotoSync: {
//     task: async ({ strapi }) => {
//       await syncAiaEmployeePhotos(strapi);
//     },
//     options: {
//       rule: '0 0 14 * * *',
//       tz: CRON_TZ,
//     },
//   },
};