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
    // Learning employee table filters
    courseId: ctx.query.courseId || ctx.query.course_id,
    status: ctx.query.status,
    filterTimeMin: ctx.query.filterTimeMin || ctx.query.filter_time_min,
    filterTimeMax: ctx.query.filterTimeMax || ctx.query.filter_time_max,
    // Content view (global) filters
    quizStatus: ctx.query.quizStatus || ctx.query.quiz_status,
    feedbackGiven: ctx.query.feedbackGiven || ctx.query.feedback_given,
  });

  return {
    async learningGlobal(ctx) {
      const emptyLearning = () => ({
        kpis: {
          totalCourses: 0,
          totalEnrollments: 0,
          completionRate: 0,
          avgTimeSpentMinutes: 0,
          avgQuizScore: 0,
          completedCourse: 0,
          dropOffRate: 0,
          dropOffCount: 0,
          totalAssignments: 0,
          certificatesIssued: 0,
        },
        statusDistribution: [],
        categoryDistribution: [],
        departmentDistribution: [],
        monthlyCompletions: [],
        learningActivityByWeek: [],
        completionFunnel: [],
        quiz: { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 },
      });
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getLearningGlobal(params) || emptyLearning();
        try {
          data.quiz = await service.getQuizGlobal(params);
          // Use avgQuizScore from getLearningGlobal (filtered); only fall back to quiz.avgScore if not set
          if (data.kpis && data.kpis.avgQuizScore === undefined) data.kpis.avgQuizScore = data.quiz?.avgScore ?? 0;
        } catch (quizError) {
          data.quiz = { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 };
          if (data.kpis && data.kpis.avgQuizScore === undefined) data.kpis.avgQuizScore = 0;
        }
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics learningGlobal error:', error?.message || error);
        ctx.body = emptyLearning();
        ctx.status = 200;
      }
    },

    async learningPersonal(ctx) {
      const emptyLearningPersonal = () => ({
        kpis: {
          totalCourses: 0,
          totalEnrollments: 0,
          completionRate: 0,
          avgTimeSpentMinutes: 0,
          avgQuizScore: 0,
          completedCourse: 0,
          dropOffRate: 0,
          dropOffCount: 0,
          certificatesEarned: 0,
        },
        statusDistribution: [],
        categoryDistribution: [],
        departmentDistribution: [],
        courseProgress: [],
        monthlyCompletions: [],
        quiz: { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 },
        moduleVideoKpis: { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 },
        moduleVideoProgress: [],
      });
      try {
        const params = getQueryParams(ctx);
        const userId = params.userId;
        if (!userId) {
          return ctx.badRequest('userId is required for personal analytics');
        }
        const service = getAnalyticsService();
        const data = await service.getLearningPersonal(userId, params) || emptyLearningPersonal();
        try {
          data.quiz = await service.getQuizPersonal(userId, params);
          if (data.kpis) data.kpis.avgQuizScore = data.quiz?.avgScore ?? 0;
        } catch (_) {
          data.quiz = { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 };
          if (data.kpis) data.kpis.avgQuizScore = 0;
        }
        try {
          const moduleVideoData = await service.getLearningPersonalModuleVideoProgress(userId, params);
          data.moduleVideoKpis = moduleVideoData?.moduleVideoKpis || {};
          data.moduleVideoProgress = moduleVideoData?.moduleVideoProgress || [];
        } catch (_) {
          data.moduleVideoKpis = { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 };
          data.moduleVideoProgress = [];
        }
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics learningPersonal error:', error?.message || error);
        ctx.body = emptyLearningPersonal();
        ctx.status = 200;
      }
    },

    async learningEmployeeTable(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getLearningEmployeeTable(params);
        ctx.body = data || { rows: [], total: 0, page: 1, pageSize: 10 };
      } catch (error) {
        strapi.log.error('Analytics learningEmployeeTable error:', error?.message || error);
        ctx.body = { rows: [], total: 0, page: 1, pageSize: 10 };
        ctx.status = 200;
      }
    },

    async learningEmployeeTableExport(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const excelBuffer = await service.getLearningEmployeeTableExport(params);
        ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        ctx.set('Content-Disposition', 'attachment; filename="employee-learning-summary.xlsx"');
        ctx.body = excelBuffer;
      } catch (error) {
        strapi.log.error('Analytics learningEmployeeTableExport error:', error);
        ctx.body = { error: 'Export failed' };
        ctx.status = 500;
      }
    },

    async overallGlobal(ctx) {
      const emptyOverall = () => ({
        kpis: { totalUsers: 0, totalActiveUsers: 0, totalHolidays: 0, totalNews: 0, totalEvents: 0, totalTownhalls: 0 },
        holidayByMonth: [],
        employeesByCompany: [],
        activeUsersByCompany: [],
        newsByCategory: [],
        eventsByType: [],
        townhallByContentType: [],
      });
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getOverallGlobal(params) || emptyOverall();
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Analytics overallGlobal error:', error?.message || error);
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
        strapi.log.error('Analytics overallPersonal error:', error?.message || error);
        ctx.body = emptyOverallPersonal();
        ctx.status = 200;
      }
    },

    async employeesList(ctx) {
      try {
        const params = getQueryParams(ctx);
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

    async coursesByDepartment(ctx) {
      try {
        const departmentId = ctx.query.departmentId || ctx.query.department_id;
        const company = ctx.query.company || ctx.query.companyId;
        const service = getAnalyticsService();
        const data = await service.getCoursesByDepartment(departmentId, company);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics coursesByDepartment error:', error?.message || error);
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

    /**
     * Track activity - creates activity log entry from frontend.
     * Requires JWT auth. User and company are auto-filled from token.
     * Body: { activity_type, activity_description, duration_seconds }
     * Note: duration_seconds will be converted to minutes for storage
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
        ctx.body = { success: false, error: error?.message || 'Activity log failed' };
        ctx.status = 200;
      }
    },
  };
};
