'use strict';

/**
 * holiday controller
 * Filters holidays by authenticated user's company (AIA/Vega) and location when applicable.
 */

const { createCoreController } = require('@strapi/strapi').factories;

async function getUserInfo(strapi, ctx) {
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
  if (!userId) return { company: null, workingLocation: null };
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['company', 'working_location', 'branch'],
  });
  const raw = (user?.company || '').trim();
  let company = null;
  if (raw) {
    const upper = raw.toUpperCase();
    if (upper === 'AIA') company = 'AIA';
    if (upper === 'VEGA') company = 'Vega';
  }
  // AIA users store location in `branch`; Vega users use `working_location`
  const workingLocation = (
    company === 'AIA'
      ? (user?.branch || user?.working_location || '')
      : (user?.working_location || user?.branch || '')
  ).trim() || null;
  return { company, workingLocation };
}

module.exports = createCoreController('api::holiday.holiday', ({ strapi }) => ({
  async find(ctx) {
    const { company: userCompany, workingLocation: userLocation } = await getUserInfo(strapi, ctx);

    const all = await strapi.db.query('api::holiday.holiday').findMany({
      where: { publishedAt: { $notNull: true }, active: true },
      orderBy: { date: 'asc' },
      populate: ['companies', 'work_locations'],
    });

    const items = (all || []).filter((h) => {
      const companies = Array.isArray(h.companies) ? h.companies : [];
      const workLocations = Array.isArray(h.work_locations) ? h.work_locations : [];

      if (h.holiday_for === 'Location') {
        // No work_locations assigned: hide (misconfigured)
        if (workLocations.length === 0) return false;
        // User location unknown: deny access (strict)
        if (!userLocation) return false;
        return workLocations.some(
          (loc) => (loc?.name || '').trim().toLowerCase() === userLocation.toLowerCase()
        );
      }

      // holiday_for === 'Company' (or unset)
      if (!userCompany) return true;
      if (companies.length === 0) return false;
      return companies.some((c) => (c?.name || '').trim() === userCompany);
    });

    ctx.body = {
      data: items,
      meta: { pagination: { page: 1, pageSize: items.length, pageCount: 1, total: items.length } },
    };
  },
}));
