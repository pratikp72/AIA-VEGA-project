// 'use strict';

// /**
//  * feedback-submission controller
//  */

// const { createCoreController } = require('@strapi/strapi').factories;

// module.exports = createCoreController("api::feedback-submission.feedback-submission", ({ strapi }) => ({

//   async submit(ctx) {
//     if (ctx.method === 'OPTIONS') return ctx.send({ ok: true });

//     // Use body from capture-feedback-body middleware (fixes empty body from frontend) or fallback to ctx.request.body
//     const rawBody = ctx.state.feedbackBody || ctx.request.body || {};
//     const data = rawBody.data || (rawBody.answers != null ? rawBody : null);

//     if (!data) return ctx.badRequest("Missing data object");
//     const { users_permissions_user: userId, course: courseId, answers: rawAnswers } = data;

//     if (!userId || !courseId) return ctx.badRequest("userId and courseId required");

//     // Transform frontend object { "q-1": 3, "additionalFeedback": "text" } into schema format:
//     // [{ question_id, question, answer_type, answer }, ...]
//     const answers = Array.isArray(rawAnswers)
//       ? rawAnswers
//       : Object.entries(rawAnswers || {}).map(([questionId, value]) => ({
//           question_id: questionId,
//           question: questionId,
//           answer_type: typeof value === 'number' ? 'Rating' : 'Text',
//           answer: String(value ?? ''),
//         }));

//     if (!answers.length) return ctx.badRequest("At least one answer required");

//     let entry;
//     try {
//       // Use entityService (not db.query) - db.query cannot build component records
//       entry = await strapi.entityService.create(
//         "api::feedback-submission.feedback-submission",
//         {
//           data: {
//             answers,
//             course: courseId,
//             users_permissions_user: userId,
//             publishedAt: new Date(), // publish immediately (draftAndPublish: true)
//           },
//         }
//       );
//     } catch (err) {
//       strapi.log.error('Feedback submission error:', err);
//       return ctx.internalServerError('Failed to create feedback submission: ' + err.message);
//     }

//     try {
//       await strapi
//         .controller("api::user-progress.user-progress")
//         .finalizeCourse(courseId, userId);
//     } catch (err) {
//       strapi.log.error('Finalize course error:', err);
//     }

//     try {
//       const meta = { courseId, userId };
//       const notifUtil = strapi.utils?.notification;
//       if (notifUtil) {
//         await notifUtil.sendNotification(
//           'feedback_submitted',
//           'Course Feedback Submitted',
//           `User ${userId} submitted feedback for course ${courseId}.`,
//           [],
//           meta,
//           ['admin', 'LMadmin']
//         );
//       }
//     } catch (err) {
//       strapi.log.error('Notification error:', err);
//     }

//     return ctx.send({
//       message: "Feedback submitted successfully & course completed",
//       submission: entry,
//     });
//   },

// }));


'use strict';

/**
 * feedback-submission controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController("api::feedback-submission.feedback-submission", ({ strapi }) => ({

  async submit(ctx) {
    if (ctx.method === 'OPTIONS') return ctx.send({ ok: true });

    // Support both nested (Strapi style: body.data) and flat payloads
    const rawBody = ctx.state.feedbackBody || ctx.request.body || {};
    const nested = rawBody.data || {};

    const courseId = Number(
      nested.course ?? nested.courseId ??
      rawBody.course ?? rawBody.courseId ?? 0
    );
    const userId = Number(
      nested.users_permissions_user ?? nested.userId ??
      rawBody.users_permissions_user ?? rawBody.userId ?? 0
    );
    const rawAnswers = Array.isArray(nested.answers) ? nested.answers
      : Array.isArray(rawBody.answers) ? rawBody.answers
      : nested.answers ?? rawBody.answers;

    if (!Number.isFinite(courseId) || courseId === 0) return ctx.badRequest('courseId is required');
    if (!Number.isFinite(userId) || userId === 0) return ctx.badRequest('userId is required');

    // Transform frontend object { "q-1": 3, "additionalFeedback": "text" } into schema format:
    // [{ question_id, question, answer_type, answer }, ...]
    const answers = Array.isArray(rawAnswers)
      ? rawAnswers
      : Object.entries(rawAnswers || {}).map(([questionId, value]) => ({
          question_id: questionId,
          question: questionId,
          answer_type: typeof value === 'number' ? 'Rating' : 'Text',
          answer: String(value ?? ''),
        }));

        console.log('answer length', answers.length);

    if (!answers.length) return ctx.badRequest("At least one answer required");

    // ADDED: fetch course title so we can store it on feedback-submission
    let courseTitle = null;
    try {
      const courseEntity = await strapi.entityService.findOne(
        "api::course.course",
        Number(courseId),
        { fields: ["title"] }
      );
      courseTitle = courseEntity?.title || null;
    } catch (err) {
      strapi.log.warn('Could not fetch course title for feedback-submission:', err);
    }

    let entry;
    try {
      // Use entityService (not db.query) - db.query cannot build component records
      entry = await strapi.entityService.create(
        "api::feedback-submission.feedback-submission",
        {
          data: /** @type {any} */ ({
            answers,
            course: Number(courseId),
            course_name: courseTitle,
            users_permissions_user: Number(userId),
            publishedAt: new Date(),
          }),
        }
      );
    } catch (err) {
      strapi.log.error('Feedback submission error:', err);
      return ctx.internalServerError('Failed to create feedback submission: ' + err.message);
    }

    // Fetch the entry with course relation populated
    let populatedEntry = null;
    try {
      populatedEntry = await strapi.entityService.findOne(
        "api::feedback-submission.feedback-submission",
        entry.id,
        { populate: { course: true } }
      );
    } catch (err) {
      strapi.log.warn('Could not populate course relation for feedback-submission:', err);
      populatedEntry = entry;
    }

    try {
      await strapi
        .controller("api::user-progress.user-progress")
        .finalizeCourse(courseId, userId, entry?.id);
    } catch (err) {
      strapi.log.error('Finalize course error:', err);
    }

    try {
      const meta = { courseId, userId };
      const notifUtil = strapi.utils?.notification;
      if (notifUtil) {
        await notifUtil.sendNotification(
          'feedback_submitted',
          'Course Feedback Submitted',
          'A user submitted course feedback.',
          [],
          meta,
          ['admin', 'LMadmin'],
          { sendEmail: true, sendSocket: true }
        );
      }
    } catch (err) {
      strapi.log.error('Notification error:', err);
    }

    return ctx.send({
      message: "Feedback submitted successfully & course completed",
      submission: populatedEntry,
    });
  },

}));