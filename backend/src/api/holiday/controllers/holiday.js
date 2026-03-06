'use strict';

/**
 * holiday controller
 * Filters holidays by authenticated user's company (AIA/Vega) when applicable.
 */

const { createCoreController } = require('@strapi/strapi').factories;

async function getUserCompany(strapi, ctx) {
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

module.exports = createCoreController('api::holiday.holiday', ({ strapi }) => ({
  async find(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    let items;
    if (userCompany) {
      const all = await strapi.db.query('api::holiday.holiday').findMany({
        where: { publishedAt: { $notNull: true }, active: true },
        orderBy: { date: 'asc' },
        populate: ['companies'],
      });
      items = (all || []).filter((h) => {
        const companies = Array.isArray(h.companies) ? h.companies : [];
        if (companies.length === 0) return false;
        return companies.some((c) => (c?.name || '').trim() === userCompany);
      });
    } else {
      items = await strapi.db.query('api::holiday.holiday').findMany({
        where: { publishedAt: { $notNull: true }, active: true },
        orderBy: { date: 'asc' },
      });
    }
    ctx.body = {
      data: items,
      meta: { pagination: { page: 1, pageSize: items.length, pageCount: 1, total: items.length } },
    };
  },
}));
