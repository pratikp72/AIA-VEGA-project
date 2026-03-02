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
            populate: {
              quiz_questions: {
                populate: { correct_multiSelect_answers: true }
              }
            }
          }
        }
      });

      // quiz is a repeatable component → array
      const quiz = course?.quiz?.[0];
      if (!quiz?.quiz_questions || quiz.quiz_questions.length === 0) return 0;

      const questions = quiz.quiz_questions;
      let earnedPoints = 0;
      let totalPoints = 0;

      // Sum all possible points across every question
      questions.forEach(q => { totalPoints += Number(q.point) || 0; });
      if (totalPoints === 0) return 0;

      // 2. Compare submitted answers with correct answers
      if (Array.isArray(answers)) {
        answers.forEach(ans => {
          const q = questions.find(q => q.question_id === ans.question_id);
          if (!q) return;

          // -----------------------------
          // MULTIPLE CHOICE LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_choice") {
            if (ans.selected_answer_for_multiChoice === q.correct_answer) {
              earnedPoints += Number(q.point) || 0;
            }
          }

          // -----------------------------
          // MULTI-SELECT LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_select") {
            const userSelected = ans.selected_answer_for_multiSelect || [];
            const correctOptions = q.correct_multiSelect_answers || [];

            const u = userSelected.map(item => item.answer).sort();
            const c = correctOptions.map(item => item.answer).sort();

            const match =
              u.length === c.length &&
              u.every((v, idx) => v === c[idx]);

            if (match) {
              earnedPoints += Number(q.point) || 0;
            }
          }
        });
      }

      // Return percentage 0–100 (frontend displays "{score}%")
      return Math.round((earnedPoints / totalPoints) * 100);
    },

    // ----------------------------------------------------------
    // ⭐ GET LATEST SUBMISSION
    // ----------------------------------------------------------
    async getLatest(ctx) {
      const { userId, courseId } = ctx.query;

      if (!userId || !courseId) {
        return ctx.badRequest('userId and courseId are required');
      }

      const submission = await strapi.db
        .query('api::quiz-submission.quiz-submission')
        .findOne({
          where: { submitted_by: Number(userId), course: Number(courseId) },
          orderBy: { attempt_number: 'desc' },
        });

      // Fetch maxAttempt from course so the frontend can display "Attempt X of Y"
      const course = await strapi.db.query('api::course.course').findOne({
        where: { id: Number(courseId) },
        populate: { quiz: true },
      });
      const maxAttempt = course?.quiz?.[0]?.max_attempt ?? 1;

      // Frontend (AssessmentQuiz.jsx) reads: resultRes?.submission and resultRes?.maxAttempt
      return ctx.send({ submission: submission || null, maxAttempt });
    },

    // ----------------------------------------------------------
    // ⭐ QUIZ SUBMIT
    // ----------------------------------------------------------
    async submit(ctx) {
      try {
        const { userId, courseId, answers } = ctx.request.body;

        console.log("[quiz submit] received body → userId:", userId, "courseId:", courseId, "type:", typeof courseId);

        if (!userId || !courseId) {
          return ctx.badRequest("userId and courseId required");
        }

        // ------------------------------------------------------
        // 1. Fetch course (for passing score + attempt limit)
        // ------------------------------------------------------
        const course = await strapi.db.query("api::course.course").findOne({
          where: { id: Number(courseId) },
          populate: { quiz: true }
        });

        console.log("[quiz submit] findOne result:", course ? `found id=${course.id}` : "NOT FOUND");

        if (!course) return ctx.badRequest(`Invalid course (id=${courseId})`);

        const minPassingScore = course.min_passing_score;
        // quiz is a repeatable component → array
        const maxAttempt = course.quiz?.[0]?.max_attempt ?? 1;

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
        // strapi.entityService handles repeatable components (answers)
        // correctly; strapi.db.query().create() cannot build component
        // records from raw data and throws "Invalid id" on [object Object].
        // ------------------------------------------------------
        const entry = await strapi.entityService.create(
          "api::quiz-submission.quiz-submission",
          {
            data: {
              answers,
              score,
              passed,
              course: courseId,
              submitted_by: userId,
              attempt_number: nextAttempt,
              submitted_at: new Date(),
              publishedAt: new Date(), // publish immediately, not draft
            },
          }
        );
  
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
      console.error("[quiz submit error]", err);
      return ctx.internalServerError(err?.message || "Failed to submit quiz");
    }
    }

  })
);