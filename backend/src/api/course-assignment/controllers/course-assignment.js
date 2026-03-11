'use strict';

/**
 * course-assignment controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::course-assignment.course-assignment', ({ strapi }) => ({
  async assign(ctx) {
    const { level, courseId, assignedBy, userId, departmentId, companyId, workLocationId } = ctx.request.body;
    const util = strapi.utils?.notification;
    if (!util) return ctx.internalServerError('Notification util not available');

    let users = [];
    if (level === 'individual' && userId) {
      const u = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId }, select: ['id', 'email'] });
      if (u) users = [u];
    } else if (level === 'department' && departmentId) {
      users = await util.getUsersByDepartment(departmentId);
    } else if (level === 'company' && companyId) {
      users = await util.getUsersByCompany(companyId);
    } else if (level === 'work_location' && workLocationId) {
      users = await util.getUsersByWorkLocation(workLocationId);
    }

    // Fetch course title for a meaningful notification message
    let courseTitle = 'A new course';
    if (courseId) {
      try {
        const course = await strapi.db.query('api::course.course').findOne({
          where: { $or: [{ id: courseId }, { documentId: courseId }] },
          select: ['title'],
        });
        if (course?.title) courseTitle = course.title;
      } catch { /* keep default */ }
    }

    // Admin → User: only the assigned user gets notification (bell) + email
    const meta = { courseId, assignedBy, level };
    await util.sendNotification(
      'course_assigned',
      'Course Assigned',
      `"${courseTitle}" has been assigned to you.`,
      users,
      meta,
      [] // no admin roles: notification goes only to user's bell + email
    );
    return ctx.send({ message: 'Course assigned and notifications sent.' });
  },
}));
