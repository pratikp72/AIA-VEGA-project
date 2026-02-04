'use strict';

/**
 * Analytics Dashboard Plugin (Server)
 *
 * Registers custom analytics API endpoints for Learning & Overall dashboards.
 * Endpoints return aggregated data in chart-ready format.
 */

const analyticsController = require('./controllers/analytics');

module.exports = {
  register({ strapi }) {
    // Register permission for analytics access
    strapi.admin.services.permission.actionProvider.registerMany([
      {
        section: 'plugins',
        displayName: 'Access Analytics Dashboard',
        uid: 'read',
        pluginName: 'analytics-dashboard',
      },
    ]);
  },

  bootstrap({ strapi }) {
    const controller = analyticsController({ strapi });

    strapi.server.routes([
      // ============ LEARNING ANALYTICS ============
      {
        method: 'GET',
        path: '/api/analytics/learning/global',
        handler: controller.learningGlobal,
        config: {
          auth: false, // Enable auth for production if needed
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/learning/personal',
        handler: controller.learningPersonal,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/learning/employee-table',
        handler: controller.learningEmployeeTable,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/learning/employee-table/export',
        handler: controller.learningEmployeeTableExport,
        config: {
          auth: false,
          policies: [],
        },
      },
      // ============ OVERALL ANALYTICS ============
      {
        method: 'GET',
        path: '/api/analytics/overall/global',
        handler: controller.overallGlobal,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/overall/personal',
        handler: controller.overallPersonal,
        config: {
          auth: false,
          policies: [],
        },
      },
      // ============ UTILITY ENDPOINTS ============
      {
        method: 'GET',
        path: '/api/analytics/employees',
        handler: controller.employeesList,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/departments',
        handler: controller.departmentsList,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/unit-locations',
        handler: controller.unitLocationsList,
        config: {
          auth: false,
          policies: [],
        },
      },
      // ============ ACTIVITY TRACKING ============
      {
        method: 'GET',
        path: '/api/analytics/activity/time-by-type-and-day',
        handler: controller.activityTimeByTypeAndDay,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/activity/log',
        handler: controller.activityLog,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/api/analytics/activity/track',
        handler: controller.activityTrack,
        config: {
          auth: { scope: ['authenticated'] },
          policies: [],
        },
      },
    ]);
  },
};
