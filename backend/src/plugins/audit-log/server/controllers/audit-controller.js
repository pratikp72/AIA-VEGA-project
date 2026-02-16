module.exports = ({ strapi }) => ({
  async getLogs(ctx) {
    try {
      const { 
        page = 1, 
        pageSize = 25,
        dateFrom,
        dateTo,
        contentType,
        action,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = ctx.query;

      const result = await strapi.plugin('audit-log').service('auditService').getAuditLogs({
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        dateFrom,
        dateTo,
        contentType,
        action,
        sortBy,
        sortOrder,
      });

      ctx.body = result;
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  async getContentTypes(ctx) {
    try {
      const contentTypes = await strapi.plugin('audit-log').service('auditService').getAvailableContentTypes();
      ctx.body = contentTypes;
    } catch (error) {
      ctx.throw(500, error);
    }
  },
});
