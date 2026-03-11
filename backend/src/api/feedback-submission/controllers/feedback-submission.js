'use strict';

/**
 * feedback-submission controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController("api::feedback-submission.feedback-submission", ({ strapi }) => ({

  async submit(ctx) {
    const { userId, courseId, answers } = ctx.request.body;

    if (!userId || !courseId) return ctx.badRequest("userId and courseId required");

    const entry = await strapi.db.query("api::feedback-submission.feedback-submission").create({
      data: {
        answers,
        course: courseId,
        users_permissions_user: userId,
        submitted_at: new Date(),
      },
    });

    // Finalize course
    await strapi
      .controller("api::user-progress.user-progress")
      .finalizeCourse(courseId, userId);

    // Notification: send to admin + LMadmin
    const meta = { courseId, userId };
    const notifUtil = strapi.utils?.notification;
    if (notifUtil) {
      await notifUtil.sendNotification(
        'feedback_submitted',
        'Course Feedback Submitted',
        `User ${userId} submitted feedback for course ${courseId}.`,
        [],
        meta,
        ['admin', 'LMadmin']
      );
    }

    return ctx.send({
      message: "Feedback submitted successfully & course completed",
      submission: entry,
    });
  },

}));
