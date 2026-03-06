'use strict';

/**
 * Analytics Controller – Shared endpoints
 * Used by both Learning and Overall dashboards: employees, departments, unit-locations, activity.
 */
const getQueryParams = require('./utils/getQueryParams');

async function getUserCompanyFromAuth(strapi, ctx) {
  let userId = ctx.state?.user?.id;
  if (!userId) {
    const authHeader = ctx.request?.header?.authorization || ctx.request?.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const jwtService = strapi.plugins?.['users-permissions']?.services?.jwt;
        if (jwtService) {
          const decoded = await jwtService.verify(token);
          userId = decoded?.id ?? decoded?._id;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }
  if (!userId) return null;
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['company'],
  });
  const raw = (user?.company || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'AIA') return 'AIA';
  if (upper === 'VEGA') return 'Vega';
  return null;
}

module.exports = ({ strapi }) => {
  const getAnalyticsService = () => require('../services/analytics')({ strapi });

  return {
    async employeesList(ctx) {
      try {
        const params = getQueryParams(ctx);
        if (!params.company || !String(params.company).trim()) {
          const userCompany = await getUserCompanyFromAuth(strapi, ctx);
          if (userCompany) params.company = userCompany;
        }
        const service = getAnalyticsService();
        const data = await service.getEmployeesList(params);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics employeesList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async departmentsList(ctx) {
      try {
        const company = ctx.query.company || ctx.query.companyId;
        const service = getAnalyticsService();
        const data = await service.getDepartmentsList(company);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics departmentsList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async unitLocationsList(ctx) {
      try {
        const company = ctx.query.company || ctx.query.companyId;
        const service = getAnalyticsService();
        const data = await service.getUnitLocationsList(company);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics unitLocationsList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async activityTimeByTypeAndDay(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityTimeByTypeAndDay(params);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics activityTimeByTypeAndDay error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async activityLog(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityLog(params);
        ctx.body = data || { rows: [], total: 0 };
      } catch (error) {
        strapi.log.error('Analytics activityLog error:', error?.message || error);
        ctx.body = { rows: [], total: 0 };
        ctx.status = 200;
      }
    },

    async activityTrackingKpis(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityTrackingKpis(params);
        ctx.body = data || { totalUser: 0, uniqueUser: 0, timeSpentMin: 0, avgTimeSpentMin: 0 };
      } catch (error) {
        strapi.log.error('Analytics activityTrackingKpis error:', error?.message || error);
        ctx.body = { totalUser: 0, uniqueUser: 0, timeSpentMin: 0, avgTimeSpentMin: 0 };
        ctx.status = 200;
      }
    },

    async activityPagesStats(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityPagesStats(params);
        ctx.body = data || { topPagesByVisit: [], leastUsedPages: [] };
      } catch (error) {
        strapi.log.error('Analytics activityPagesStats error:', error?.message || error);
        ctx.body = { topPagesByVisit: [], leastUsedPages: [] };
        ctx.status = 200;
      }
    },

    async activityNewsList(ctx) {
      try {
        const service = getAnalyticsService();
        const data = await service.getNewsForActivityFilter();
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics activityNewsList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async activityTrack(ctx) {
      try {
        const user = ctx.state?.user;
        if (!user || !user.id) {
          return ctx.unauthorized('Authentication required. Send JWT in Authorization header.');
        }
        const body = ctx.request?.body || {};
        const { activity_type, activity_description, duration_seconds } = body;
        const validTypes = ['News', 'Event', 'Course', 'Quiz', 'Feedback', 'Location', 'Routes', 'People', 'Gallery', 'Home', 'Company policy', 'Form & Templates', 'Calendar'];
        if (!activity_type || !validTypes.includes(activity_type)) {
          return ctx.badRequest(`activity_type is required and must be one of: ${validTypes.join(', ')}`);
        }
        if (!activity_description || typeof activity_description !== 'string') {
          return ctx.badRequest('activity_description is required (string)');
        }
        const secs = Math.max(0, parseInt(duration_seconds, 10) || 0);
        const service = getAnalyticsService();
        const entry = await service.createActivityLog({
          user_id: user.id,
          company: user.company || null,
          activity_type,
          activity_description: activity_description.trim(),
          duration_seconds: secs,
        });
        ctx.body = { success: true, id: entry?.id ?? entry?.documentId };
        ctx.status = 201;
      } catch (error) {
        strapi.log.error('Analytics activityTrack error:', error);
        ctx.body = { success: false, error: error?.message || 'Activity log failed' };
        ctx.status = 200;
      }
    },
  };
};
