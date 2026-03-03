const UID = 'api::quiz-reattempt-request.quiz-reattempt-request';

module.exports = ({ strapi }) => ({
  async getAll() {
    // Use db.query to read directly from DB (entityService may filter out records created via db.query)
    const entries = await strapi.db.query(UID).findMany({
      populate: ['users_permissions_user', 'course'],
      orderBy: { createdAt: 'desc' },
    });

    strapi.log.info('[quiz-reattempt plugin] getAll count:', entries?.length ?? 0);

    return entries;
  },

  async updateStatus(id, newStatus) {
    // id can be documentId (string) or numeric id
    const isNumeric = /^\d+$/.test(String(id));
    const where = isNumeric ? { id: Number(id) } : { documentId: String(id) };

    const existing = await strapi.db.query(UID).findOne({ where });
    if (!existing) {
      strapi.log.warn('[quiz-reattempt plugin] updateStatus: not found', id);
      throw new Error('Request not found');
    }

    await strapi.db.query(UID).update({
      where: { id: existing.id },
      data: { request_status: newStatus },
    });

    const updated = await strapi.db.query(UID).findOne({
      where: { id: existing.id },
      populate: ['users_permissions_user', 'course'],
    });
    if (!updated) return null;

    const user = updated.users_permissions_user;
    const course = updated.course;
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
