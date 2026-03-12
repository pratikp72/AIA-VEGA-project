"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Get the most recent rejected request for user+course; returns null if none or if rejection is older than 24h for send (allowRerequestAfter24h). */
async function getLatestRejectedForUserCourse(strapi, userId, courseId, allowRerequestAfter24h = false) {
  const list = await strapi.db
    .query("api::quiz-reattempt-request.quiz-reattempt-request")
    .findMany({
      where: {
        users_permissions_user: Number(userId),
        course: Number(courseId),
        request_status: "Rejected",
      },
      orderBy: { updatedAt: "desc" },
      limit: 1,
    });
  const latest = Array.isArray(list) && list.length > 0 ? list[0] : null;
  if (!latest) return null;
  if (!allowRerequestAfter24h) return latest;
  const updatedAt = latest.updatedAt ? new Date(latest.updatedAt).getTime() : 0;
  const now = Date.now();
  if (now - updatedAt < REJECTION_COOLDOWN_MS) return latest; // still within 24h
  return null; // older than 24h → allow new request
}

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

      // If admin rejected a reattempt within the last 24 hours, user cannot apply again until 24h have passed
      const recentRejection = await getLatestRejectedForUserCourse(strapi, userId, courseId, true);
      if (recentRejection) {
        return ctx.badRequest(
          "Your reattempt request was rejected. You can submit a new request after 24 hours."
        );
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
      const notifUtil = strapi.utils?.notification;
      if (notifUtil) {
        // Resolve names for descriptive admin email
        let courseTitle = null;
        let userName = null;
        try {
          const [courseRow, userRow] = await Promise.all([
            strapi.db.query('api::course.course').findOne({ where: { id: Number(courseId) }, select: ['title'] }),
            strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: Number(userId) }, select: ['username', 'email'] }),
          ]);
          courseTitle = courseRow?.title || null;
          userName = userRow?.username || userRow?.email || null;
        } catch { /* keep null */ }

        const meta = { courseId, userId, courseTitle, userName };
        notifUtil.sendNotification(
          "quiz_reattempt_requested",
          "Quiz Reattempt Requested",
          `${userName || `User #${userId}`} has requested a quiz reattempt${courseTitle ? ` for "${courseTitle}"` : ''}. Please review and approve or reject the request in the admin panel.`,
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
      const [pending, latestRejected] = await Promise.all([
        strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findOne({
            where: {
              users_permissions_user: uid,
              course: cid,
              request_status: "Pending",
            },
          }),
        getLatestRejectedForUserCourse(strapi, uid, cid, false), // get raw latest (no 24h filter)
      ]);
      const rejectedAt = latestRejected?.updatedAt ? new Date(latestRejected.updatedAt).getTime() : null;
      const now = Date.now();
      const hasRejectedWithin24h = rejectedAt != null && (now - rejectedAt) < REJECTION_COOLDOWN_MS;
      const canRequestAgainAt = rejectedAt != null ? new Date(rejectedAt + REJECTION_COOLDOWN_MS).toISOString() : null;
      return ctx.send({
        hasPending: !!pending,
        hasRejected: hasRejectedWithin24h,
        canRequestAgainAt: hasRejectedWithin24h ? canRequestAgainAt : null,
      });
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