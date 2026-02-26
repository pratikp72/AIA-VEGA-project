"use strict";

/**
 * quiz-submission controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::quiz-submission.quiz-submission",
  ({ strapi }) => ({

  async submit(ctx) {
    try {
      const { userId, courseId, answers, score } = ctx.request.body;

      if (!userId || !courseId) {
        return ctx.badRequest("userId and courseId required");
      }

      // --------------------------------------------
      // 1. Fetch course (to get passing score & max attempt)
      // --------------------------------------------
      const course = await strapi.db.query("api::course.course").findOne({
        where: { id: courseId },
        populate: { quiz: true }
      });

      if (!course) return ctx.badRequest("Invalid course");

      const minPassingScore = course.min_passing_score;
      const maxAttempt = course.quiz?.max_attempt ?? 1;  // stored inside quiz component

      // --------------------------------------------
      // 2. Fetch user's last quiz submission for this course
      // --------------------------------------------
      const lastSubmission = await strapi.db
        .query("api::quiz-submission.quiz-submission")
        .findOne({
          where: { submitted_by: userId, course: courseId },
          orderBy: { attempt_number: "desc" }
        });

      const lastAttempt = lastSubmission?.attempt_number || 0;
      const nextAttempt = lastAttempt + 1;

      // --------------------------------------------
      // 3. Determine pass or fail
      // --------------------------------------------
      const passed = score >= minPassingScore;

      // --------------------------------------------
      // 4. If FAILED & user reached max_attempt → Block further attempts
      // --------------------------------------------
      if (!passed && lastAttempt >= maxAttempt) {
        return ctx.send({
          message: `Max attempts reached (${maxAttempt}). Please request a reattempt.`,
          reattempt_required: true
      });
      }

      // --------------------------------------------
      // 5. If admin approved request → allow next attempt
      // --------------------------------------------
      const approvedRequest = await strapi.db
        .query("api::quiz-reattempt-request.quiz-reattempt-request")
        .findOne({
          where: {
            course: courseId,
            users_permissions_user: userId,
            request_status: "Approved"
          }
        });

      if (approvedRequest) {
        // After user uses the approved attempt → mark request as consumed
        await strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .update({
            where: { id: approvedRequest.id },
            data: { request_status: "Used" }
          });
      }

      // --------------------------------------------
      // 6. Create quiz submission
      // --------------------------------------------
      const entry = await strapi.db
        .query("api::quiz-submission.quiz-submission")
        .create({
          data: {
            answers,
            score,
            passed,
            course: courseId,
            submitted_by: userId,
            attempt_number: nextAttempt,
            submitted_at: new Date()
          }
        });

      // --------------------------------------------
      // 7. Update user progress
      // --------------------------------------------
      /** @type {any} */
      const userProgressController = strapi.controller(
        "api::user-progress.user-progress"
      );

      await userProgressController.updateAfterQuiz(courseId, userId, passed);

      return ctx.send({
        message: "Quiz submitted successfully",
        submission: entry,
      });

    } catch (err) {
      console.error(err);
      return ctx.internalServerError("Failed to submit quiz");
    }
  }

}));