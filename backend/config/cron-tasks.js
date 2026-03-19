'use strict';

const { syncEmployeesFromHrms } = require('../src/cron-tasks/sync-employees');

module.exports = {
  // Runs once daily at 2:00 AM — employee data doesn't change frequently
  // Use the manual trigger endpoint for on-demand syncs during development
  employeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncEmployeesFromHrms(strapi);
    },
    options: {
      rule: '*/10 * * * *',
    },
  },
};
