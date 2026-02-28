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

    const meta = { courseId, assignedBy, level };
    await util.sendNotification(
      'course_assigned',
      'Course Assigned',
      'A new course has been assigned to you.',
      users,
      meta,
      ['LMadmin', 'admin']
    );
    return ctx.send({ message: 'Course assigned and notifications sent.' });
  },
}));
