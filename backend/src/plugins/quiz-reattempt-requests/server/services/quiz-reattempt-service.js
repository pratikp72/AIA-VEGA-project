module.exports = ({ strapi }) => ({
  async getAll() {
    const entries = await strapi.entityService.findMany('api::quiz-reattempt-request.quiz-reattempt-request', {
      populate: {
        users_permissions_user: {
          fields: ['username', 'email', 'employee_name'],
        },
        course: {
          fields: ['title'],
        },
      },
      sort: { createdAt: 'desc' },
    });

    return entries;
  },

  async updateStatus(id, newStatus) {
    const updated = await strapi.entityService.update('api::quiz-reattempt-request.quiz-reattempt-request', id, {
      data: {
        request_status: newStatus,
      },
    });

    return updated;
  },
});
