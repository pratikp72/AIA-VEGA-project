'use strict';

/**
 * gallery-item controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::gallery-item.gallery-item', ({ strapi }) => ({
  async findFiltered(ctx) {
    const { company, type, sortBy, search, date, page, pageSize } = ctx.query;
    const companyQuery = company != null ? String(company) : '';
    const typeQuery = type != null ? String(type) : '';
    const sortByQuery = sortBy != null ? String(sortBy) : '';
    const searchQuery = search != null ? String(search) : '';
    const dateQuery = date != null ? String(date) : '';
    const pageNum = Math.max(1, Number(page) || 1);
    const pageSizeNum = Math.max(1, Math.min(100, Number(pageSize) || 24));

    // ---- 1) Build filters ----
    /** @type {any} */
    const filters = {};

    // Company filter:
    // - If company is a relation: filter by related company.name (case-insensitive)
    // - If company is a simple field: filter by that field
    if (companyQuery) {
      filters.$and = filters.$and || [];
      filters.$and.push({
        $or: [
          { company: { name: { $eqi: companyQuery } } }, // relation with name
          { company: { $eqi: companyQuery } }, // simple string field
        ],
      });
    }

    // Type filter: 'image' | 'video' from frontend
    // In this project schema, the field is `media_type` (enumeration: "Image" | "Video").
    if (typeQuery) {
      const t = typeQuery.toLowerCase();
      const value = t === 'video' ? 'Video' : 'Image';
      filters.$and = filters.$and || [];
      filters.$and.push({
        media_type: { $eqi: value },
      });
    }

    // Search filter: title and description (case-insensitive contains)
    if (searchQuery && searchQuery.trim()) {
      const s = searchQuery.trim();
      filters.$and = filters.$and || [];
      filters.$and.push({
        $or: [
          { title: { $containsi: s } },
          { description: { $containsi: s } },
        ],
      });
    }

    // Date filter: exact day match on `createdAt` field only.
    if (dateQuery) {
      const dayStart = new Date(dateQuery);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dateQuery);
      dayEnd.setHours(23, 59, 59, 999);

      filters.$and = filters.$and || [];
      filters.$and.push({
        createdAt: {
          $gte: dayStart.toISOString(),
          $lte: dayEnd.toISOString(),
        },
      });
    }

    // ---- 2) Build sort ----
    let sort = [];
    const normalizedSortBy = sortByQuery.trim().toLowerCase();
    switch (normalizedSortBy) {
      case 'oldest':
        sort = [{ date: 'asc' }, { createdAt: 'asc' }];
        break;
      case 'title a-z':
      case 'title-asc':
        sort = [{ title: 'asc' }];
        break;
      case 'title z-a':
      case 'title-desc':
        sort = [{ title: 'desc' }];
        break;
      case 'latest':
      case 'newest':
      default:
        sort = [{ date: 'desc' }, { createdAt: 'desc' }];
        break;
    }

    // ---- 3) Populate relations/media so frontend has URLs & company name ----
    const populate = ['image', 'video', 'company'];

    const [entities, total] = await Promise.all([
      strapi.db.query('api::gallery-item.gallery-item').findMany({
        where: filters,
        orderBy: sort,
        offset: (pageNum - 1) * pageSizeNum,
        limit: pageSizeNum,
        populate,
      }),
      strapi.db.query('api::gallery-item.gallery-item').count({ where: filters }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / pageSizeNum));

    ctx.body = {
      data: entities,
      meta: {
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          pageCount,
          total,
        },
      },
    };
  },
}));
