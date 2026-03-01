"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::quiz-reattempt-request.quiz-reattempt-request",
  ({ strapi }) => ({

    async send(ctx) {
      const { userId, courseId } = ctx.request.body;

      if (!userId || !courseId) {
        return ctx.badRequest("userId and courseId required");
      }

      // Check if pending request already exists
      const existing = await strapi.db
        .query("api::quiz-reattempt-request.quiz-reattempt-request")
        .findOne({
          where: {
            users_permissions_user: userId,
            course: courseId,
            request_status: "Pending",
          },
        });

      if (existing) {
        return ctx.badRequest("You already have a pending reattempt request.");
      }

      // Find last submission to know next attempt
      const lastSubmission = await strapi.db
        .query("api::quiz-submission.quiz-submission")
        .findOne({
          where: { submitted_by: userId, course: courseId },
          orderBy: { attempt_number: "desc" },
        });

      if (!lastSubmission) {
        return ctx.badRequest("No quiz attempt found.");
      }

      const nextAttempt = lastSubmission.attempt_number + 1;

      // Create new pending request
      const request = await strapi.db
        .query("api::quiz-reattempt-request.quiz-reattempt-request")
        .create({
          data: {
            users_permissions_user: userId,
            course: courseId,
            request_status: "Pending",
            requested_for_attempt: nextAttempt,
          },
        });

      // Notification: send to LMadmin + admin
      const meta = { courseId, userId };
      const notifUtil = strapi.utils?.notification;
      if (notifUtil) {
        await notifUtil.sendNotification(
          "quiz_reattempt_requested",
          "Quiz Reattempt Requested",
          `User ${userId} requested a quiz reattempt for course ${courseId}.`,
          [],
          meta,
          ["LMadmin", "admin"]
        );
      }

      return ctx.send({
        message: "Reattempt request sent successfully.",
        request,
      });
    },

    async approve(ctx) {
      const { requestId } = ctx.request.body;
      if (!requestId) return ctx.badRequest('requestId required');
      // Find request
      const request = await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').findOne({ where: { id: requestId } });
      if (!request) return ctx.notFound('Request not found');
      // Update status
      await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').update({
        where: { id: requestId },
        data: { request_status: 'Approved' },
      });
      // Notify user
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: request.users_permissions_user }, select: ['id', 'email'] });
      const meta = { courseId: request.course, requestId };
      const notifUtil = strapi.utils?.notification;
      if (notifUtil && user) {
        await notifUtil.sendNotification(
          'quiz_reattempt_approved',
          'Quiz Reattempt Approved',
          `Your quiz reattempt request for course ${request.course} has been approved.`,
          [user],
          meta,
          []
        );
      }
      return ctx.send({ message: 'Request approved and user notified.' });
    },

  })
);