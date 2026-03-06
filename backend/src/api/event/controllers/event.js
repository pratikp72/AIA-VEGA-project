'use strict';

/**
 * event controller
 * Filters events by authenticated user's company (AIA/Vega) when applicable.
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

module.exports = createCoreController('api::event.event', ({ strapi }) => ({
  async find(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    const where = { publishedAt: { $notNull: true } };
    if (userCompany) {
      where.company = { name: userCompany };
    }
    const items = await strapi.db.query('api::event.event').findMany({
      where,
      orderBy: { start_date: 'asc' },
      populate: ['event_image', 'company', 'department'],
    });
    ctx.body = {
      data: items,
      meta: { pagination: { page: 1, pageSize: items.length, pageCount: 1, total: items.length } },
    };
  },
  async findOne(ctx) {
    const id = ctx.params.documentId ?? ctx.params.id;
    if (!id) return ctx.badRequest('Missing event id');
    const item = await strapi.db.query('api::event.event').findOne({
      where: { $or: [{ documentId: id }, { id: Number(id) || 0 }] },
      populate: ['event_image', 'company', 'department'],
    });
    if (!item) return ctx.notFound();
    ctx.body = { data: item };
  },
}));
