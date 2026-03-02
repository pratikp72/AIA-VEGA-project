module.exports = ({ strapi }) => ({
  async getAll() {
    const entries = await strapi.entityService.findMany('api::quiz-reattempt-request.quiz-reattempt-request', {
      populate: {
        users_permissions_user: {
          fields: ['username', 'email', 'employee_name', 'company', 'emp_code', 'emp_id'],
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
    const idStr = String(id).trim();
    const isNumeric = /^\d+$/.test(idStr);
    const where = isNumeric ? { id: Number(idStr) } : { documentId: idStr };

    const request = await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').findOne({
      where,
      populate: ['users_permissions_user', 'course'],
    });
    if (!request) return null;

    const updated = await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').update({
      where,
      data: { request_status: newStatus },
    });

    const user = request.users_permissions_user;
    const course = request.course;
    const courseTitle = (course?.title ?? course?.attributes?.title ?? 'the course') || 'the course';
    const notifUtil = strapi.utils?.notification;
    if (notifUtil && user) {
      const userId = user.id ?? user.documentId;
      const userObj = { id: userId, email: user.email ?? user.attributes?.email };
      const meta = { courseId: course?.id ?? course?.documentId, requestId: id };
      if (newStatus === 'Approved') {
        await notifUtil.sendNotification(
          'quiz_reattempt_approved',
          'Quiz Reattempt Approved',
          `Your quiz reattempt request for "${courseTitle}" has been approved.`,
          [userObj],
          meta,
          []
        );
      } else if (newStatus === 'Rejected') {
        await notifUtil.sendNotification(
          'quiz_reattempt_rejected',
          'Quiz Reattempt Rejected',
          `Your quiz reattempt request for "${courseTitle}" has been rejected.`,
          [userObj],
          meta,
          []
        );
      }
    }

    return updated;
  },
});
