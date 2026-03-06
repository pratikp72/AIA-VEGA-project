'use strict';

/**
 * form-template controller
 * Filters form templates by authenticated user's company (AIA/Vega).
 */

const { createCoreController } = require('@strapi/strapi').factories;
const getUserCompany = require('../../../utils/getUserCompany');

module.exports = createCoreController('api::form-template.form-template', ({ strapi }) => ({
  async find(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    const where = { publishedAt: { $notNull: true }, active: true };
    if (userCompany) {
      where.company = { name: userCompany };
    }
    const items = await strapi.db.query('api::form-template.form-template').findMany({
      where,
      orderBy: { createdAt: 'desc' },
      populate: ['form_pdf', 'form_excel', 'form_word', 'company'],
    });
    ctx.body = {
      data: items,
      meta: { pagination: { page: 1, pageSize: items.length, pageCount: 1, total: items.length } },
    };
  },

  async findOne(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    const docId = ctx.params.documentId ?? ctx.params.id;
    const where = { publishedAt: { $notNull: true } };
    if (docId) where.documentId = docId;
    if (userCompany) where.company = { name: userCompany };
    const item = await strapi.db.query('api::form-template.form-template').findOne({
      where,
      populate: ['form_pdf', 'form_excel', 'form_word', 'company'],
    });
    if (!item) {
      return ctx.notFound();
    }
    ctx.body = { data: item };
  },
}));
