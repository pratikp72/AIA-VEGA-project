// 'use strict';

// /**
//  * quiz-submission controller
//  */

// const { createCoreController } = require('@strapi/strapi').factories;

// module.exports = createCoreController("api::quiz-submission.quiz-submission", ({ strapi }) => ({

//   async submit(ctx) {
//     const { userId, courseId, answers, score, passed } = ctx.request.body;

//     if (!userId || !courseId) return ctx.badRequest("userId and courseId required");

//     // Save quiz submission
//     const entry = await strapi.db.query("api::quiz-submission.quiz-submission").create({
//       data: {
//         answers,
//         score,
//         passed,
//         course: courseId,
//         submitted_by: userId,
//         submitted_at: new Date(),
//       },
//     });

//     // Notify user-progress controller
//     await strapi
//       .controller("api::user-progress.user-progress")
//       .updateAfterQuiz(courseId, userId, passed);

//     return ctx.send({
//       message: "Quiz submitted successfully",
//       submission: entry,
//     });
//   },

// }));

"use strict";

/**
 * quiz-submission controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::quiz-submission.quiz-submission",
  ({ strapi }) => ({

    async submit(ctx) {
      const { userId, courseId, answers, score, passed } = ctx.request.body;

      if (!userId || !courseId) {
        return ctx.badRequest("userId and courseId required");
      }

      // Save quiz submission
      const entry = await strapi.db
        .query("api::quiz-submission.quiz-submission")
        .create({
          data: {
            answers,
            score,
            passed,
            course: courseId,
            submitted_by: userId,
            submitted_at: new Date(),
          },
        });

      /** @type {any} */
      const userProgressController = strapi.controller(
        "api::user-progress.user-progress"
      );

      await userProgressController.updateAfterQuiz(courseId, userId, passed);

      return ctx.send({
        message: "Quiz submitted successfully",
        submission: entry,
      });
    },

  })
);