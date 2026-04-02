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
      const { request_status } = ctx.request.body.data || {};

      if (!request_status || !['Approved', 'Rejected'].includes(request_status)) {
        return ctx.throw(400, 'request_status must be Approved or Rejected');
      }

      const updated = await strapi.plugin('profile-edit-requests').service('profileEditService').updateStatus(
        id,
        request_status,
        ctx.state.user
      );
      
      ctx.body = { data: updated };
    } catch (error) {
      if (error?.message?.includes('not found')) {
        return ctx.throw(404, error.message);
      }
      if (error?.message?.includes('Only pending requests')) {
        return ctx.throw(400, error.message);
      }
      if (error?.message?.includes('No valid changes to apply')) {
        return ctx.throw(400, error.message);
      }
      ctx.throw(500, error.message || 'Failed to update profile edit request status');
    }
  },
});
