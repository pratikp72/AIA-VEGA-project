'use strict';

/**
 * gallery-item controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::gallery-item.gallery-item', ({ strapi }) => ({
  async findFiltered(ctx) {
    const { company, type, sortBy, search, date } = ctx.query;

    // ---- 1) Build filters ----
    const filters = {};

    // Company filter:
    // - If company is a relation: filter by related company.name (case-insensitive)
    // - If company is a simple field: filter by that field
    if (company) {
      filters.$and = filters.$and || [];
      filters.$and.push({
        $or: [
          { company: { name: { $eqi: company } } }, // relation with name
          { company: { $eqi: company } }, // simple string field
        ],
      });
    }

    // Type filter: 'image' | 'video' from frontend
    // In this project schema, the field is `media_type` (enumeration: "Image" | "Video").
    if (type) {
      const t = String(type).toLowerCase();
      const value = t === 'video' ? 'Video' : 'Image';
      filters.$and = filters.$and || [];
      filters.$and.push({
        media_type: { $eqi: value },
      });
    }

    // Search filter: title and description (case-insensitive contains)
    if (search && search.trim()) {
      const s = search.trim();
      filters.$and = filters.$and || [];
      filters.$and.push({
        $or: [
          { title: { $containsi: s } },
          { description: { $containsi: s } },
        ],
      });
    }

    // Date filter: exact day match (on `date` field if present, else `createdAt`)
    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      filters.$and = filters.$and || [];
      filters.$and.push({
        $or: [
          {
            date: {
              $gte: dayStart.toISOString(),
              $lte: dayEnd.toISOString(),
            },
          },
          {
            createdAt: {
              $gte: dayStart.toISOString(),
              $lte: dayEnd.toISOString(),
            },
          },
        ],
      });
    }

    // ---- 2) Build sort ----
    let sort = [];
    switch (sortBy) {
      case 'oldest':
        sort = [{ date: 'asc' }, { createdAt: 'asc' }];
        break;
      case 'title-asc':
        sort = [{ title: 'asc' }];
        break;
      case 'title-desc':
        sort = [{ title: 'desc' }];
        break;
      case 'newest':
      default:
        sort = [{ date: 'desc' }, { createdAt: 'desc' }];
        break;
    }

    // ---- 3) Populate relations/media so frontend has URLs & company name ----
    const populate = {
      image: true,
      video: true,
      company: true, // or { fields: ['name'] } if you want only name
    };

    // ---- 4) Query Strapi ----
    const entities = await strapi.entityService.findMany('api::gallery-item.gallery-item', {
      filters,
      sort,
      populate,
    });

    // ---- 5) Return in standard { data: [...] } format ----
    ctx.body = { data: entities };
  },
}));
