'use strict';

/**
 * news controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function ensurePublishDateNotPast(data) {
  const pub = data?.publish_date ?? data?.published_date ?? data?.publishedDate;
  if (!pub) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(pub);
  d.setHours(0, 0, 0, 0);
  if (d < today) {
    throw new Error('Please select current or future date.');
  }
}

module.exports = createCoreController('api::news.news', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishDateNotPast(body);
    return super.create(ctx);
  },
  async update(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishDateNotPast(body);
    return super.update(ctx);
  },
}));
