'use strict';

const { ensureWorkLocationForUser } = require('../utils/ensure-work-location-for-user');

/**
 * After a user is created or updated via Content Manager, ensure a Work Location entry exists.
 * For AIA company, use 'branch' field; for Vega company, use 'working_location' field.
 */
module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await next();
    const method = ctx.method;
    const path = (ctx.path || ctx.request?.path || '').toLowerCase();
    strapi.log.info(`[WorkLocationMW] Triggered for path: ${path}, method: ${method}, status: ${ctx.status}`);
    if (!path.includes('content-manager') || !path.includes('users-permissions.user')) {
      strapi.log.info('[WorkLocationMW] Not a user Content Manager route. Skipping.');
      return;
    }
    if (method !== 'POST' && method !== 'PUT') {
      strapi.log.info('[WorkLocationMW] Not a POST or PUT. Skipping.');
      return;
    }
    if (ctx.status < 200 || ctx.status > 299) {
      strapi.log.info(`[WorkLocationMW] Status not 2xx (${ctx.status}). Skipping.`);
      return;
    }

    const body = ctx.body;
    if (!body) {
      strapi.log.info('[WorkLocationMW] No body found. Skipping.');
      return;
    }
    const doc = body?.document ?? body?.data ?? body;
    const company = doc?.company;
    let locationName = null;
    if (company === 'AIA') {
      locationName = doc?.branch;
    } else if (company === 'Vega') {
      locationName = doc?.working_location;
    }
    strapi.log.info(`[WorkLocationMW] company: ${company}, locationName: ${locationName}`);
    if (!locationName || !company) {
      strapi.log.info('[WorkLocationMW] Missing locationName or company. Skipping.');
      return;
    }

    try {
      await ensureWorkLocationForUser(strapi, locationName, company);
      strapi.log.info(`[WorkLocationMW] ensureWorkLocationForUser called for location: ${locationName}, company: ${company}`);
    } catch (err) {
      strapi.log.warn('ensureWorkLocationForUser (middleware) failed', err);
    }
  };
};
