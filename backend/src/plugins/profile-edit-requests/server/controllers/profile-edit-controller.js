module.exports = ({ strapi }) => ({
  async getRequests(ctx) {
    try {
      const data = await strapi.plugin('profile-edit-requests').service('profileEditService').getAll();
      ctx.body = { data };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  async updateStatus(ctx) {
    try {
      const { id } = ctx.params;
      const { request_status, admin_comment } = ctx.request.body.data || {};
      
      if (!request_status) {
        return ctx.throw(400, 'request_status is required');
      }

      const updated = await strapi.plugin('profile-edit-requests').service('profileEditService').updateStatus(
        id, 
        request_status,
        admin_comment,
        ctx.state.user
      );
      
      ctx.body = { data: updated };
    } catch (error) {
      ctx.throw(500, error);
    }
  },
});
