"use strict";

/**
 * quiz-submission controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::quiz-submission.quiz-submission",
  ({ strapi }) => ({

    // ----------------------------------------------------------
    // ⭐ SCORE CALCULATION LOGIC
    // ----------------------------------------------------------
    async calculateScore(courseId, answers) {
      // 1. Fetch quiz questions from course
      const course = await strapi.db.query("api::course.course").findOne({
        where: { id: courseId },
        populate: {
          quiz: {
            populate: ["quiz_questions"]
          }
        }
      });

      if (!course?.quiz?.quiz_questions) return 0;

      const questions = course.quiz.quiz_questions;
      let totalScore = 0;

      // 2. Compare submitted answers with correct answers
      if (Array.isArray(answers)) {
        answers.forEach(ans => {
          const q = questions.find(q => q.question_id === ans.question_id);
          if (!q) return;

          // -----------------------------
          // MULTIPLE CHOICE LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_choice") {
            const userAnswer = ans.selected_answer_for_multiChoice;
            const correctAnswer = q.correct_answer;

            if (userAnswer === correctAnswer) {
              totalScore += q.point || 0;
            }
          }

          // -----------------------------
          // MULTI-SELECT LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_select") {
            const userSelected = ans.selected_answer_for_multiSelect || [];
            const correctOptions = q.correct_answers || [];

            // Convert both to sorted arrays (easy comparison)
            const u = userSelected.map(item => item.answer).sort();
            const c = correctOptions.map(item => item.answer).sort();

            const match =
              u.length === c.length &&
              u.every((v, idx) => v === c[idx]);

            if (match) {
              totalScore += q.point || 0;
            }
          }
        });
      }

      return totalScore;
    },

    // ----------------------------------------------------------
    // ⭐ QUIZ SUBMIT
    // ----------------------------------------------------------
    async submit(ctx) {
      try {
        const { userId, courseId, answers } = ctx.request.body;

        if (!userId || !courseId) {
          return ctx.badRequest("userId and courseId required");
        }

        // ------------------------------------------------------
        // 1. Fetch course (for passing score + attempt limit)
        // ------------------------------------------------------
        const course = await strapi.db.query("api::course.course").findOne({
          where: { id: courseId },
          populate: { quiz: true }
        });

        if (!course) return ctx.badRequest("Invalid course");

        const minPassingScore = course.min_passing_score;
        const maxAttempt = course.quiz?.max_attempt ?? 1;

        // ------------------------------------------------------
        // 2. Fetch user's last submission
        // ------------------------------------------------------
        const lastSubmission = await strapi.db
          .query("api::quiz-submission.quiz-submission")
          .findOne({
            where: { submitted_by: userId, course: courseId },
            orderBy: { attempt_number: "desc" }
          });

        const lastAttempt = lastSubmission?.attempt_number || 0;
        const nextAttempt = lastAttempt + 1;

        // ------------------------------------------------------
        // 3. Calculate score securely (backend only)
        // ------------------------------------------------------
        const score = await this.calculateScore(courseId, answers);
        const passed = score >= minPassingScore;

        // ------------------------------------------------------
        // 4. If FAILED + reached max_attempt → block
        // ------------------------------------------------------
        if (!passed && lastAttempt >= maxAttempt) {
          return ctx.send({
            message: `Max attempts reached (${maxAttempt}). Request reattempt.`,
            reattempt_required: true
          });
        }

        // ------------------------------------------------------
        // 5. If admin approved reattempt → allow + mark as used
        // ------------------------------------------------------
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
          await strapi.db
            .query("api::quiz-reattempt-request.quiz-reattempt-request")
            .update({
              where: { id: approvedRequest.id },
              data: { request_status: "Used" }
            });
        }

        // ------------------------------------------------------
        // 6. Create quiz submission
        // ------------------------------------------------------
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

        // ------------------------------------------------------
        // 7. Update user progress
        // ------------------------------------------------------
        /** @type {any} */
      const userProgressController = strapi.controller(
        "api::user-progress.user-progress"
      );

      await userProgressController.updateAfterQuiz(courseId, userId, passed);

        // ------------------------------------------------------
        // 8. Notification: send to admin + LMadmin
        // ------------------------------------------------------
        const meta = { courseId, userId, score, passed };
        const notifUtil = strapi.utils?.notification;
        if (notifUtil) {
          await notifUtil.sendNotification(
            'quiz_submitted',
            'Quiz Submitted',
            `User ${userId} submitted a quiz for course ${courseId}.`,
            [],
            meta,
            ['admin', 'LMadmin']
          );
        }

      return ctx.send({
        message: "Quiz submitted successfully",
        submission: entry,
      });

    } catch (err) {
      console.error(err);
      return ctx.internalServerError("Failed to submit quiz");
    }
    }

  })
);