'use strict';

/**
 * news controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function ensurePublishedDateNotPast(data) {
  const pub = data?.published_date ?? data?.publishedDate;
  if (!pub) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(pub);
  d.setHours(0, 0, 0, 0);
  if (d < today) {
    throw new Error('published_date cannot be in the past. Please select today or a future date.');
  }
}

module.exports = createCoreController('api::news.news', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishedDateNotPast(body);
    return super.create(ctx);
  },
  async update(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishedDateNotPast(body);
    return super.update(ctx);
  },
}));
