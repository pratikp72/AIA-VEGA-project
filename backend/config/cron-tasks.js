'use strict';

const { syncEmployeesFromHrms } = require('../src/cron-tasks/sync-employees');
const { syncVegaEmployees } = require('../src/cron-tasks/sync-vega-employees');

module.exports = {
  // AIA employees — fetched from HRMS API
  employeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncEmployeesFromHrms(strapi);
    },
    options: {
      rule: '*/10 * * * *',
    },
  },

  // Vega employees — fetched from OneDrive Excel via MS Graph
  vegaEmployeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncVegaEmployees(strapi);
    },
    options: {
      rule: '*/10 * * * *',
    },
  },
};
