'use strict';

/**
 * Overall Analytics Controller
 * Handles Overall dashboard API: global and personal portal engagement.
 */
const getQueryParams = require('./utils/getQueryParams');

module.exports = ({ strapi }) => {
  const getAnalyticsService = () => require('../services/analytics')({ strapi });

  return {
    async overallGlobal(ctx) {
      const emptyOverall = () => ({
        kpis: { totalUsers: 0, totalActiveUsers: 0, totalHolidays: 0, totalNews: 0, totalTownhalls: 0 },
        holidayByMonth: [],
        employeesByCompany: [],
        activeUsersByCompany: [],
        newsByCategory: [],
        townhallByContentType: [],
      });
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getOverallGlobal(params) || emptyOverall();
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Overall overallGlobal error:', error?.message || error);
        ctx.body = emptyOverall();
        ctx.status = 200;
      }
    },

    async overallPersonal(ctx) {
      const emptyOverallPersonal = () => ({
        kpis: { totalHolidays: 0 },
        holidayByMonth: [],
        employeesByCompany: [],
      });
      try {
        const params = getQueryParams(ctx);
        const userId = params.userId;
        if (!userId) {
          return ctx.badRequest('userId is required for personal analytics');
        }
        const service = getAnalyticsService();
        const data = await service.getOverallPersonal(userId, params) || emptyOverallPersonal();
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Overall overallPersonal error:', error?.message || error);
        ctx.body = emptyOverallPersonal();
        ctx.status = 200;
      }
    },
  };
};
