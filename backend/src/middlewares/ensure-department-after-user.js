'use strict';

const { ensureDepartmentForUser } = require('../utils/ensure-department-for-user');

/**
 * After a user is created or updated via Content Manager, ensure a Department entry exists.
 */
module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await next();
    const method = ctx.method;
    const path = (ctx.path || ctx.request?.path || '').toLowerCase();
    if (!path.includes('content-manager') || !path.includes('users-permissions.user')) return;
    if (method !== 'POST' && method !== 'PUT') return;
    if (ctx.status < 200 || ctx.status > 299) return;

    const body = ctx.body;
    if (!body) return;
    const doc = body?.document ?? body?.data ?? body;
    const department = doc?.department;
    const company = doc?.company;
    if (!department || !company) return;

    try {
      await ensureDepartmentForUser(strapi, department, company);
    } catch (err) {
      strapi.log.warn('ensureDepartmentForUser (middleware) failed', err);
    }
  };
};
