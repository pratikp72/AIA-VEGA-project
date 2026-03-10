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
                populate: {
                  correct_multiSelect_answers: true,
                  options: true,
                }
              }
            }
          }
        }
      });

      // quiz is a repeatable component → array. Pick the block that best matches submitted question_ids.
      const answerQuestionIds = new Set(
        (Array.isArray(answers) ? answers : [])
          .map((a) => a?.question_id)
          .filter((id) => typeof id === 'string' && id.trim().length > 0)
      );

      const pickBestQuiz = (quizList) => {
        if (!Array.isArray(quizList) || quizList.length === 0) return null;
        if (answerQuestionIds.size === 0) return quizList[0];

        let best = quizList[0];
        let bestMatchCount = -1;

        quizList.forEach((qz) => {
          const qList = Array.isArray(qz?.quiz_questions) ? qz.quiz_questions : [];
          const matchCount = qList.reduce((count, q) => {
            return count + (answerQuestionIds.has(q?.question_id) ? 1 : 0);
          }, 0);

          if (matchCount > bestMatchCount) {
            best = qz;
            bestMatchCount = matchCount;
          }
        });

        return best;
      };

      const quiz = pickBestQuiz(course?.quiz);
      if (!quiz?.quiz_questions || quiz.quiz_questions.length === 0) return 0;

      const questions = quiz.quiz_questions;
      let earnedPoints = 0;
      let totalPoints = 0;

      const normalizeToken = (v) => {
        if (v == null) return '';
        return String(v).trim().toLowerCase();
      };

      const areSetsEqual = (a, b) => {
        if (a.size !== b.size) return false;
        for (const v of a) {
          if (!b.has(v)) return false;
        }
        return true;
      };

      // Accept either option key or label in submissions and stored answers.
      const buildEquivalentChoiceTokens = (question, rawValue) => {
        const token = normalizeToken(rawValue);
        const out = new Set();
        if (!token) return out;
        out.add(token);

        const options = Array.isArray(question?.options) ? question.options : [];
        options.forEach((opt) => {
          const key = normalizeToken(opt?.option_key);
          const label = normalizeToken(opt?.option_label);
          if (!key && !label) return;
          if (token === key || token === label) {
            if (key) out.add(key);
            if (label) out.add(label);
          }
        });

        return out;
      };

      const extractSubmittedMultiSelectValues = (submitted) => {
        if (!Array.isArray(submitted)) return [];
        return submitted
          .map((item) => {
            if (item == null) return null;
            if (typeof item === 'string' || typeof item === 'number') return item;
            if (typeof item === 'object') {
              return item.answer ?? item.option_key ?? item.option_label ?? null;
            }
            return null;
          })
          .filter((v) => v != null);
      };

      // Helper: use point from question if present, else 1 point per question (when point field removed)
      const getPoints = (q) => {
        const p = Number(q?.point);
        return p > 0 ? p : 1;
      };

      // Sum all possible points across every question
      questions.forEach(q => { totalPoints += getPoints(q); });
      if (totalPoints === 0) return 0;

      // 2. Compare submitted answers with correct answers
      if (Array.isArray(answers)) {
        answers.forEach(ans => {
          const q = questions.find(q => q.question_id === ans.question_id);
          if (!q) return;

          const pts = getPoints(q);

          // -----------------------------
          // MULTIPLE CHOICE LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_choice") {
            const submittedChoice = buildEquivalentChoiceTokens(q, ans.selected_answer_for_multiChoice);
            const correctChoice = buildEquivalentChoiceTokens(q, q.correct_answer);
            const isCorrect = [...submittedChoice].some((token) => correctChoice.has(token));

            if (isCorrect) {
              earnedPoints += pts;
            }
          }

          // -----------------------------
          // MULTI-SELECT LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_select") {
            const userSelected = extractSubmittedMultiSelectValues(ans.selected_answer_for_multiSelect);
            const correctOptions = q.correct_multiSelect_answers || [];

            const userTokens = new Set();
            userSelected.forEach((value) => {
              buildEquivalentChoiceTokens(q, value).forEach((t) => userTokens.add(t));
            });

            const correctRaw = correctOptions
              .map((item) => item?.answer)
              .filter((v) => v != null);
            const correctTokens = new Set();
            correctRaw.forEach((value) => {
              buildEquivalentChoiceTokens(q, value).forEach((t) => correctTokens.add(t));
            });

            // Collapse equivalent key/label representations to canonical tokens where possible.
            const canonicalize = (tokenSet) => {
              const canonical = new Set();
              const options = Array.isArray(q?.options) ? q.options : [];

              tokenSet.forEach((token) => {
                let mapped = token;
                options.forEach((opt) => {
                  const key = normalizeToken(opt?.option_key);
                  const label = normalizeToken(opt?.option_label);
                  if (token === label && key) mapped = key;
                });
                canonical.add(mapped);
              });

              return canonical;
            };

            const match = areSetsEqual(canonicalize(userTokens), canonicalize(correctTokens));

            if (match) {
              earnedPoints += pts;
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
        const { userId, courseId, answers, time_taken_minutes } = ctx.request.body;

        console.log("[quiz submit] received body → userId:", userId, "courseId:", courseId, "type:", typeof courseId);

        if (!userId || !courseId) {
          return ctx.badRequest("userId and courseId required");
        }

        // ------------------------------------------------------
        // 0. If admin rejected a reattempt within the last 24h → block assessment (after 24h user can request again)
        // ------------------------------------------------------
        const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
        const rejectedList = await strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findMany({
            where: {
              course: Number(courseId),
              users_permissions_user: Number(userId),
              request_status: "Rejected",
            },
            orderBy: { updatedAt: "desc" },
            limit: 1,
          });
        const latestRejected = Array.isArray(rejectedList) && rejectedList.length > 0 ? rejectedList[0] : null;
        if (latestRejected && latestRejected.updatedAt) {
          const rejectedAt = new Date(latestRejected.updatedAt).getTime();
          if (Date.now() - rejectedAt < REJECTION_COOLDOWN_MS) {
            return ctx.forbidden(
              "Your reattempt request was rejected. You can submit a new request after 24 hours."
            );
          }
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

        const minPassingScoreRaw = Number(course.min_passing_score);
        const minPassingScore = Number.isFinite(minPassingScoreRaw) ? minPassingScoreRaw : 0;
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
        const scoreRaw = await this.calculateScore(courseId, answers);
        const score = Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : 0;
        const passed = score >= minPassingScore;

        // ------------------------------------------------------
        // 4. If FAILED + would exceed max_attempt → block (do not save)
        // Show re-attempt when current attempt === max_attempt, not only when trying attempt > max.
        // So block when they already used all attempts and are trying to submit again.
        // ------------------------------------------------------
        if (!passed && nextAttempt > maxAttempt) {
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
              time_taken_minutes,
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
        // 8. Notification + email: Admin and LM Admin
        // ------------------------------------------------------
        /** @type {any} */
        const strapiAny = strapi;
        const notifUtil = strapiAny?.utils?.notification;
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

          const meta = { courseId, userId, score, passed, courseTitle, userName };
          await notifUtil.sendNotification(
            'quiz_submitted',
            'Quiz Submitted',
            `${userName || `User #${userId}`} has submitted the quiz${courseTitle ? ` for "${courseTitle}"` : ''}. Score: ${score}% — ${passed ? 'PASSED ✓' : 'FAILED ✗'}. Please review the result in the admin panel.`,
            [],
            meta,
            ['admin', 'LMadmin'],
            { sendEmail: true, sendSocket: true }
          );
        }

        // When user failed and this attempt used all allowed attempts → show re-attempt (e.g. max_attempt=1, failed 1st time)
        const reattemptRequired = !passed && nextAttempt >= maxAttempt;

      return ctx.send({
        message: "Quiz submitted successfully",
        submission: entry,
        ...(reattemptRequired && { reattempt_required: true }),
      });

    } catch (err) {
      console.error("[quiz submit error]", err);
      return ctx.internalServerError(err?.message || "Failed to submit quiz");
    }
    }

  })
);