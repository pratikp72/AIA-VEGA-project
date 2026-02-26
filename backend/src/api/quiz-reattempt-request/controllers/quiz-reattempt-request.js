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

      return ctx.send({
        message: "Reattempt request sent successfully.",
        request,
      });
    },

  })
);