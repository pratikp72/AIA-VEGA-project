"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController("api::user-progress.user-progress", ({ strapi }) => ({

  /**
   * User must choose language before starting the course.
   * Language saved permanently in user-progress.language_selected.
   * User cannot change language after start.
   */
  async startCourse(ctx) {
    const { userId, courseId, language } = ctx.request.body;

    if (!userId || !courseId || !language) {
      return ctx.badRequest("userId, courseId & language are required");
    }

    const uid = "api::user-progress.user-progress";
    const now = new Date();

    // Check if progress exists
    const existing = await strapi.db.query(uid).findOne({
      where: { user: userId, course: courseId },
    });

    // If already exists → prevent language changes
    if (existing) {
      if (existing.language_selected && existing.language_selected !== language) {
        return ctx.badRequest("Language cannot be changed after starting the course.");
      }

      await strapi.db.query(uid).update({
        where: { id: existing.id },
        data: {
          progress_status: "In_progress",
          last_accessed_at: now,
        },
      });

      return ctx.send({
        message: "Course already started; progress updated.",
      });
    }

    // Create new entry
    const entry = await strapi.db.query(uid).create({
      data: {
        user: userId,
        course: courseId,
        progress_status: "In_progress",
        progress_percentage: 0,
        completed_modules: [],
        language_selected: language,
        started_at: now,
        last_accessed_at: now,
        time_spent_minutes: 0,
        certificate_issued: false,
      },
    });

    return ctx.send({
      message: "Course started successfully",
      progress: entry,
    });
  },

  /**
   * Mark module completed.
   * Checks if all modules completed → then enforce QUIZ → FEEDBACK flow.
   */
  async markModuleRead(ctx) {
    const { userId, courseId, moduleId } = ctx.request.body;

    if (!userId || !courseId || !moduleId) {
      return ctx.badRequest("userId, courseId, moduleId required");
    }

    const uid = "api::user-progress.user-progress";

    // Fetch progress
    let progress = await strapi.db.query(uid).findOne({
      where: { user: userId, course: courseId },
    });

    // Auto-create if missing — user may mark a module without going through start-course
    if (!progress) {
      const now = new Date();
      progress = await strapi.db.query(uid).create({
        data: {
          user: userId,
          course: courseId,
          progress_status: 'In_progress',
          progress_percentage: 0,
          completed_modules: [],
          last_accessed_at: now,
          time_spent_minutes: 0,
          certificate_issued: false,
        },
      });
    }

    // Add module if not completed
    const completed = new Set(progress.completed_modules);
    completed.add(moduleId);

    await strapi.db.query(uid).update({
      where: { id: progress.id },
      data: { completed_modules: [...completed] },
    });

    // Fetch full course to check quiz/feedback conditions
    const course = await strapi.db.query("api::course.course").findOne({
      where: { id: courseId },
      populate: { modules: true, quiz: true, feedback: true },
    });

    const totalModules = course.modules.length;
    const completedCount = completed.size;

    let nextStep = "continue";

    if (completedCount === totalModules) {
      const quizCompulsory = course.quiz?.[0]?.compulsory ?? false;
      const feedbackCompulsory = course.feedback?.[0]?.compulsory ?? false;

      if (quizCompulsory) nextStep = "quiz_required";
      else if (feedbackCompulsory) nextStep = "feedback_required";
      else nextStep = "course_complete_allowed";
    }

    return ctx.send({
      message: "Module marked completed",
      completed_modules: [...completed],
      nextStep,
    });
  },

  /**
   * Called by quiz-submission controller when quiz is passed/failed.
   * If quiz compulsory and failed → progress = Failed
   */
  async updateAfterQuiz(courseId, userId, passed) {
    const uid = "api::user-progress.user-progress";

    const progress = await strapi.db.query(uid).findOne({
      where: { user: userId, course: courseId },
    });



    if (!progress) return;

    if (passed === false) {
      await strapi.db.query(uid).update({
        where: { id: progress.id },
        data: { progress_status: "Failed" },
      });
    } else {
      await strapi.db.query(uid).update({
        where: { id: progress.id },
        data: { progress_status: "In_progress" },
      });
    }
  },

  /**
   * GET /api/user-progress/progress?userId=&courseId=
   * Returns the progress record (including completed_modules) for a user+course pair.
   */
  async getProgress(ctx) {
    const { userId, courseId } = ctx.query;
    if (!userId || !courseId) {
      return ctx.badRequest('userId and courseId are required');
    }
    const uid = 'api::user-progress.user-progress';
    const progress = await strapi.db.query(uid).findOne({
      where: { user: Number(userId), course: Number(courseId) },
    });
    if (!progress) {
      return ctx.send({ completed_modules: [], progress_status: null });
    }
    return ctx.send(progress);
  },

  /**
   * Called after feedback submission.
   * If quiz passed & feedback submitted → course completed.
   */
  async finalizeCourse(courseId, userId) {
    const uid = "api::user-progress.user-progress";

    const now = new Date();

    await strapi.db.query(uid).update({
      where: { user: userId, course: courseId },
      data: {
        progress_status: "Completed",
        completed_at: now,
        certificate_issued: true,
      },
    });
  },

}));