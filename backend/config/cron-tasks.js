// @ts-nocheck
'use strict';

const { syncEmployeesFromHrms } = require('../src/cron-tasks/sync-employees');
const { syncVegaEmployees } = require('../src/cron-tasks/sync-vega-employees');
const { syncAiaEmployeePhotos } = require('../src/cron-tasks/sync-aia-employee-photos');

module.exports = {
  // AIA employees — fetched from HRMS API
  employeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncEmployeesFromHrms(strapi);
    },
    options: {
      rule: '0 0 14 * * *',
    },
  },

  // Vega employees — fetched from OneDrive Excel via MS Graph
  vegaEmployeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncVegaEmployees(strapi);
    },
    options: {
      rule: '0 0 14 * * *',
    },
  },

  // AIA employee photos — synced from mounted NFS share at /mnt/empimages
  // Runs once daily at 2 AM. Only updates users that don't yet have a photo.
  aiaEmployeePhotoSync: {
    task: async ({ strapi }) => {
      await syncAiaEmployeePhotos(strapi);
    },
    options: {
      rule: '0 0 14 * * *',
    },
  },
};
