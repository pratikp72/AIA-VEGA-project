'use strict';

/**
 * event controller
 * Filters events by authenticated user's company (AIA/Vega) and department when applicable.
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
  if (!userId) return { company: null, department: null };
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['company', 'department'],
  });
  const raw = (user?.company || '').trim();
  let company = null;
  if (raw) {
    const upper = raw.toUpperCase();
    if (upper === 'AIA') company = 'AIA';
    else if (upper === 'VEGA') company = 'Vega';
  }
  const department = (user?.department || '').trim() || null;
  return { company, department };
}

module.exports = createCoreController('api::event.event', ({ strapi }) => ({
  async find(ctx) {
    const { company: userCompany, department: userDepartment } = await getUserInfo(strapi, ctx);
    const where = { publishedAt: { $notNull: true } };
    if (userCompany) {
      where.company = { name: userCompany };
    }
    const items = await strapi.db.query('api::event.event').findMany({
      where,
      orderBy: { start_date: 'asc' },
      populate: ['event_image', 'company', 'department'],
    });

    // Filter department-specific events: only show to users in that department.
    // Events with event_created_for = 'All' (or unset) are always shown.
    const filtered = items.filter((ev) => {
      if (!ev.event_created_for || ev.event_created_for === 'All') return true;
      if (ev.event_created_for === 'department') {
        const evDept = (ev.department?.name || '').trim().toLowerCase();
        const uDept = (userDepartment || '').toLowerCase();
        // If we can't determine the user's department, show the event anyway
        if (!uDept) return true;
        return evDept === uDept;
      }
      return true;
    });

    ctx.body = {
      data: filtered,
      meta: { pagination: { page: 1, pageSize: filtered.length, pageCount: 1, total: filtered.length } },
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
