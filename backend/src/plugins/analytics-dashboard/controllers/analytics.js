'use strict';

/**
 * Analytics Controller - Handles analytics API requests
 */

module.exports = ({ strapi }) => {
  const getAnalyticsService = () => {
    const analyticsService = require('../services/analytics')({ strapi });
    return analyticsService;
  };

  const getQueryParams = (ctx) => ({
    userId: ctx.query.userId || ctx.query.user_id,
    dateFrom: ctx.query.dateFrom || ctx.query.date_from,
    dateTo: ctx.query.dateTo || ctx.query.date_to,
    department: ctx.query.department,
    company: ctx.query.company,
    unitLocation: ctx.query.unitLocation || ctx.query.unit_location,
    activityType: ctx.query.activityType || ctx.query.activity_type,
    courseCategory: ctx.query.courseCategory || ctx.query.course_category,
    search: ctx.query.search,
    sortBy: ctx.query.sortBy || ctx.query.sort_by,
    sortOrder: ctx.query.sortOrder || ctx.query.sort_order,
    page: ctx.query.page,
    pageSize: ctx.query.pageSize || ctx.query.page_size,
  });

  return {
    async learningGlobal(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getLearningGlobal(params);

        // Include quiz data
        const quizData = await service.getQuizGlobal(params);
        data.quiz = quizData;

        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics learningGlobal error:', error);
        ctx.throw(500, error.message);
      }
    },

    async learningPersonal(ctx) {
      try {
        const params = getQueryParams(ctx);
        const userId = params.userId;

        if (!userId) {
          return ctx.badRequest('userId is required for personal analytics');
        }

        const service = getAnalyticsService();
        const data = await service.getLearningPersonal(userId, params);

        if (!data) {
          return ctx.notFound('No learning data found for this user');
        }

        // Include quiz data
        const quizData = await service.getQuizPersonal(userId, params);
        data.quiz = quizData;

        // Include module video progress (watched fully vs skipped to end)
        const moduleVideoData = await service.getLearningPersonalModuleVideoProgress(userId, params);
        data.moduleVideoKpis = moduleVideoData.moduleVideoKpis;
        data.moduleVideoProgress = moduleVideoData.moduleVideoProgress;

        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics learningPersonal error:', error);
        ctx.throw(500, error.message);
      }
    },

    async learningEmployeeTable(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getLearningEmployeeTable(params);
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics learningEmployeeTable error:', error);
        const msg = error?.message || 'Failed to load employee table';
        ctx.throw(500, msg);
      }
    },

    async learningEmployeeTableExport(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const csv = await service.getLearningEmployeeTableExport(params);
        ctx.set('Content-Type', 'text/csv; charset=utf-8');
        ctx.set('Content-Disposition', 'attachment; filename="employee-learning-summary.csv"');
        ctx.body = csv;
      } catch (error) {
        strapi.log.error('Analytics learningEmployeeTableExport error:', error);
        const msg = error?.message || 'Failed to export employee table';
        ctx.throw(500, msg);
      }
    },

    async overallGlobal(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getOverallGlobal(params);
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics overallGlobal error:', error);
        ctx.throw(500, error.message);
      }
    },

    async overallPersonal(ctx) {
      try {
        const params = getQueryParams(ctx);
        const userId = params.userId;

        if (!userId) {
          return ctx.badRequest('userId is required for personal analytics');
        }

        const service = getAnalyticsService();
        const data = await service.getOverallPersonal(userId, params);

        if (!data) {
          return ctx.notFound('No overall data found for this user');
        }

        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics overallPersonal error:', error);
        ctx.throw(500, error.message);
      }
    },

    async employeesList(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getEmployeesList(params);
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics employeesList error:', error);
        ctx.throw(500, error.message);
      }
    },

    async departmentsList(ctx) {
      try {
        const service = getAnalyticsService();
        const data = await service.getDepartmentsList();
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics departmentsList error:', error);
        ctx.throw(500, error.message);
      }
    },

    async unitLocationsList(ctx) {
      try {
        const service = getAnalyticsService();
        const data = await service.getUnitLocationsList();
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics unitLocationsList error:', error);
        ctx.throw(500, error.message);
      }
    },

    async activityTimeByTypeAndDay(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityTimeByTypeAndDay(params);
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics activityTimeByTypeAndDay error:', error);
        ctx.throw(500, error.message);
      }
    },

    async activityLog(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityLog(params);
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics activityLog error:', error);
        ctx.throw(500, error.message);
      }
    },

    /**
     * Track activity - creates activity log entry from frontend.
     * Requires JWT auth. User and company are auto-filled from token.
     * Body: { activity_type, activity_description, duration_seconds }
     */
    async activityTrack(ctx) {
      try {
        const user = ctx.state?.user;
        if (!user || !user.id) {
          return ctx.unauthorized('Authentication required. Send JWT in Authorization header.');
        }

        const body = ctx.request?.body || {};
        const { activity_type, activity_description, duration_seconds } = body;

        const validTypes = ['News_Reading', 'Event_Info', 'Townhall_Video', 'Townhall_PDF', 'Holiday_View'];
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
        ctx.throw(500, error.message);
      }
    },
  };
};
