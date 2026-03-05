"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::quiz-reattempt-request.quiz-reattempt-request",
  ({ strapi }) => ({

    async send(ctx) {
      // Use captured body (fixes empty body from frontend) or fallback to ctx.request.body
      const body = ctx.state.quizReattemptBody || ctx.request.body || {};
      const { userId, courseId } = body;

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

      // If admin already rejected a reattempt request, user cannot apply again
      const existingRejected = await strapi.db
        .query("api::quiz-reattempt-request.quiz-reattempt-request")
        .findOne({
          where: {
            users_permissions_user: Number(userId),
            course: Number(courseId),
            request_status: "Rejected",
          },
        });

      if (existingRejected) {
        return ctx.badRequest("Your reattempt request was rejected. You cannot apply again for this assessment.");
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

      // Create new pending request (db.query for reliable persistence; plugin admin reads same collection)
      let request;
      try {
        request = await strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .create({
            data: {
              users_permissions_user: Number(userId),
              course: Number(courseId),
              request_status: "Pending",
              requested_for_attempt: nextAttempt,
            },
          });
      } catch (createErr) {
        strapi.log.error('[quiz-reattempt send] create failed:', createErr);
        return ctx.internalServerError(createErr?.message || "Failed to create reattempt request");
      }

      // Notification + email: Admin and LM Admin (run in background so response returns quickly)
      const meta = { courseId, userId };
      const notifUtil = strapi.utils?.notification;
      if (notifUtil) {
        notifUtil.sendNotification(
          "quiz_reattempt_requested",
          "Quiz Reattempt Requested",
          "A user requested a quiz reattempt.",
          [],
          meta,
          ["admin", "LMadmin"],
          { sendEmail: true, sendSocket: true }
        ).catch((err) => strapi.log.error('[quiz-reattempt send] notification error:', err?.message || err));
      }

      return ctx.send({
        message: "Reattempt request sent successfully.",
        request,
      });
    },

    async checkPending(ctx) {
      const { userId, courseId } = ctx.query;
      if (!userId || !courseId) {
        return ctx.badRequest("userId and courseId are required");
      }
      const uid = Number(userId);
      const cid = Number(courseId);
      const [pending, rejected] = await Promise.all([
        strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findOne({
            where: {
              users_permissions_user: uid,
              course: cid,
              request_status: "Pending",
            },
          }),
        strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findOne({
            where: {
              users_permissions_user: uid,
              course: cid,
              request_status: "Rejected",
            },
          }),
      ]);
      return ctx.send({ hasPending: !!pending, hasRejected: !!rejected });
    },

    async approve(ctx) {
      const { requestId } = ctx.request.body;
      if (!requestId) return ctx.badRequest('requestId required');
      const request = await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').findOne({ where: { id: requestId } });
      if (!request) return ctx.notFound('Request not found');
      await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').update({
        where: { id: requestId },
        data: { request_status: 'Approved' },
      });
      // User notification (bell + email) is sent by quiz-reattempt-notification lifecycle
      return ctx.send({ message: 'Request approved and user notified.' });
    },

    async reject(ctx) {
      const { requestId } = ctx.request.body;
      if (!requestId) return ctx.badRequest('requestId required');
      const request = await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').findOne({ where: { id: requestId } });
      if (!request) return ctx.notFound('Request not found');
      await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').update({
        where: { id: requestId },
        data: { request_status: 'Rejected' },
      });
      // User notification (bell + email) is sent by quiz-reattempt-notification lifecycle
      return ctx.send({ message: 'Request rejected and user notified.' });
    },

  })
);