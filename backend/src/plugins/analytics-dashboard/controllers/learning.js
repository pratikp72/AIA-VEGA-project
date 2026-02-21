'use strict';

/**
 * Learning Analytics Controller
 * Handles Learning dashboard API: global (course), personal, employee table, courses/modules.
 */
const getQueryParams = require('./utils/getQueryParams');

module.exports = ({ strapi }) => {
  const getAnalyticsService = () => require('../services/analytics')({ strapi });

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
        moduleDetailTable: [],
      });
      try {
        const params = getQueryParams(ctx);
        if (params.moduleTitle) params.moduleTitle = String(params.moduleTitle).trim();
        if (params.moduleIndex !== undefined && params.moduleIndex !== null && params.moduleIndex !== '') {
          params.moduleIndex = Number(params.moduleIndex);
        }
        const service = getAnalyticsService();
        const data = await service.getLearningGlobal(params) || emptyLearning();
        try {
          data.quiz = await service.getQuizGlobal(params);
          if (data.kpis && data.kpis.avgQuizScore === undefined) data.kpis.avgQuizScore = data.quiz?.avgScore ?? 0;
        } catch (quizError) {
          data.quiz = { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 };
          if (data.kpis && data.kpis.avgQuizScore === undefined) data.kpis.avgQuizScore = 0;
        }
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Learning learningGlobal error:', error?.message || error);
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
          if (data.kpis) {
            data.kpis.avgQuizScore = data.quiz?.avgScore ?? 0;
            data.kpis.quizPassRate = data.quiz?.passRate ?? 0;
          }
        } catch (_) {
          data.quiz = { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 };
          if (data.kpis) {
            data.kpis.avgQuizScore = 0;
            data.kpis.quizPassRate = 0;
          }
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
        strapi.log.error('Learning learningPersonal error:', error?.message || error);
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
        strapi.log.error('Learning learningEmployeeTable error:', error?.message || error);
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
        strapi.log.error('Learning learningEmployeeTableExport error:', error);
        ctx.body = { error: 'Export failed' };
        ctx.status = 500;
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
        strapi.log.error('Learning coursesByDepartment error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async courseModules(ctx) {
      try {
        const courseId = ctx.query.courseId || ctx.query.course_id;
        if (!courseId) {
          ctx.body = [];
          return;
        }
        const service = getAnalyticsService();
        const data = await service.getCourseModules(courseId);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Learning courseModules error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },
  };
};
