'use strict';

const { syncEmployeesFromHrms } = require('../src/cron-tasks/sync-employees');

module.exports = {
  employeeSyncEveryTenMinutes: {
    task: async ({ strapi }) => {
      await syncEmployeesFromHrms(strapi);
    },
    options: {
      rule: '*/10 * * * *',
    },
  },
};
