'use strict';

/**
 * department router
 * Create is restricted: only Super Admin can create departments (via Admin panel).
 * REST API create is blocked by policy; in Admin set Roles so only Super Admin has Create on Department.
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::department.department', {
  config: {
    create: {
      policies: ['global::restrict-department-create'],
    },
  },
});
