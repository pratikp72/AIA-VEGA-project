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
    const numUserId = Number(userId);
    const numCourseId = await this.resolveCourseId(courseId);
    if (numCourseId == null) {
      return ctx.badRequest("Invalid courseId");
    }

    // Fetch progress (try documents first - only published; fallback to draft for existing records)
    let progress = null;
    try {
      let list = await strapi.documents(uid).findMany({
        filters: { user: { id: numUserId }, course: { id: numCourseId } },
        status: 'published',
        limit: 1,
      });
      progress = Array.isArray(list) && list.length > 0 ? list[0] : null;
      if (!progress) {
        list = await strapi.documents(uid).findMany({
          filters: { user: { id: numUserId }, course: { id: numCourseId } },
          status: 'draft',
          limit: 1,
        });
        progress = Array.isArray(list) && list.length > 0 ? list[0] : null;
      }
    } catch (e) {
      strapi.log.warn('markModuleRead findMany failed, trying db.query:', e?.message);
      progress = await strapi.db.query(uid).findOne({
        where: { user: numUserId, course: numCourseId },
      });
    }

    // Auto-create if missing — user may mark a module without going through start-course
    if (!progress) {
      const now = new Date();
      try {
        progress = await strapi.documents(uid).create({
          data: {
            user: { connect: [{ id: numUserId }] },
            course: { connect: [{ id: numCourseId }] },
            progress_status: 'In_progress',
            progress_percentage: 0,
            completed_modules: [],
            last_accessed_at: now,
            time_spent_minutes: 0,
            certificate_issued: false,
          },
          status: 'published',
        });
      } catch (createErr) {
        strapi.log.warn('markModuleRead documents create failed, trying db.query:', createErr?.message);
        progress = await strapi.db.query(uid).create({
          data: {
            user: numUserId,
            course: numCourseId,
            progress_status: 'In_progress',
            progress_percentage: 0,
            completed_modules: [],
            last_accessed_at: now,
            time_spent_minutes: 0,
            certificate_issued: false,
          },
        });
      }
    }

    // Add module if not completed (normalize to string for consistent matching)
    const completed = new Set((progress.completed_modules || []).map(String));
    completed.add(String(moduleId));

    try {
      if (progress.documentId) {
        await strapi.documents(uid).update({
          documentId: progress.documentId,
          data: { completed_modules: [...completed] },
          status: 'published',
        });
      } else {
        await strapi.db.query(uid).update({
          where: { id: progress.id },
          data: { completed_modules: [...completed] },
        });
      }
    } catch (updateErr) {
      strapi.log.warn('markModuleRead update failed:', updateErr?.message);
      await strapi.db.query(uid).update({
        where: { id: progress.id },
        data: { completed_modules: [...completed] },
      });
    }

    // Fetch full course to check quiz/feedback conditions
    const course = await strapi.db.query("api::course.course").findOne({
      where: { id: numCourseId },
      populate: { modules: true, quiz: true, feedback: true },
    });

    if (!course) {
      return ctx.send({
        message: "Module marked completed",
        completed_modules: [...completed],
        nextStep: "continue",
      });
    }

    const totalModules = Array.isArray(course.modules) ? course.modules.length : 0;
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
   * GET /api/user-progress/all?userId=
   * Returns all progress records for a user (for merging with course list to show completed).
   */
  async getAllProgress(ctx) {
    const { userId } = ctx.query;
    if (!userId) return ctx.badRequest('userId is required');
    const uid = 'api::user-progress.user-progress';
    const records = await strapi.documents(uid).findMany({
      filters: { user: { id: Number(userId) } },
      populate: ['course'],
      status: 'published',
      limit: 500,
    });
    const byCourse = {};
    (Array.isArray(records) ? records : []).forEach((r) => {
      const courseId = r.course?.id ?? r.course_id ?? r.course;
      if (courseId != null) {
        byCourse[Number(courseId)] = {
          progress_status: r.progress_status,
          completed: r.progress_status === 'Completed',
          completed_at: r.completed_at,
          certificate_issued: r.certificate_issued,
        };
      }
    });
    return ctx.send(byCourse);
  },

  /**
   * Resolve courseId to numeric id (handles documentId from frontend).
   */
  async resolveCourseId(courseId) {
    const num = Number(courseId);
    if (!Number.isNaN(num)) return num;
    const course = await strapi.documents('api::course.course').findFirst({
      filters: { documentId: { $eq: String(courseId) } },
    });
    return course?.id ?? null;
  },

  /**
   * GET /api/user-progress/progress?userId=&courseId=
   * Returns the progress record (including completed_modules) for a user+course pair.
   * Uses strapi.documents for Strapi 5 compatibility (db.query has relation column issues).
   * courseId can be numeric id or documentId.
   */
  async getProgress(ctx) {
    const { userId, courseId } = ctx.query;
    if (!userId || !courseId) {
      return ctx.badRequest('userId and courseId are required');
    }
    const numUserId = Number(userId);
    const numCourseId = await this.resolveCourseId(courseId);
    if (numCourseId == null) {
      return ctx.send({ completed_modules: [], progress_status: null });
    }
    const uid = 'api::user-progress.user-progress';
    let progress = null;
    try {
      let list = await strapi.documents(uid).findMany({
        filters: { user: { id: numUserId }, course: { id: numCourseId } },
        status: 'published',
        limit: 1,
      });
      progress = Array.isArray(list) && list.length > 0 ? list[0] : null;
      if (!progress) {
        list = await strapi.documents(uid).findMany({
          filters: { user: { id: numUserId }, course: { id: numCourseId } },
          status: 'draft',
          limit: 1,
        });
        progress = Array.isArray(list) && list.length > 0 ? list[0] : null;
      }
    } catch (e) {
      strapi.log.warn('getProgress documents failed, trying db.query fallback:', e?.message);
      progress = await strapi.db.query(uid).findOne({
        where: { user: numUserId, course: numCourseId },
      });
    }
    if (!progress) {
      return ctx.send({ completed_modules: [], progress_status: null });
    }
    return ctx.send({
      completed_modules: progress.completed_modules || [],
      progress_status: progress.progress_status,
    });
  },

  /**
   * Called after feedback submission.
   * If quiz passed & feedback submitted → course completed.
   * Uses strapi.documents (same as getProgress) so the update is visible when user returns.
   * courseId can be numeric or documentId.
   */
  async finalizeCourse(courseId, userId) {
    const uid = "api::user-progress.user-progress";
    const now = new Date();
    const numUserId = Number(userId);
    const numCourseId = await this.resolveCourseId(courseId);
    if (numCourseId == null) {
      strapi.log.warn('finalizeCourse: could not resolve courseId', courseId);
      return;
    }

    let existing = null;
    try {
      const list = await strapi.documents(uid).findMany({
        filters: { user: { id: numUserId }, course: { id: numCourseId } },
        status: 'published',
        limit: 1,
      });
      existing = Array.isArray(list) && list.length > 0 ? list[0] : null;
      if (!existing) {
        const draftList = await strapi.documents(uid).findMany({
          filters: { user: { id: numUserId }, course: { id: numCourseId } },
          status: 'draft',
          limit: 1,
        });
        existing = Array.isArray(draftList) && draftList.length > 0 ? draftList[0] : null;
      }
    } catch (e) {
      strapi.log.warn('finalizeCourse findMany failed:', e?.message);
      existing = await strapi.db.query(uid).findOne({
        where: { user: numUserId, course: numCourseId },
      });
    }

    if (existing) {
      try {
        if (existing.documentId) {
          await strapi.documents(uid).update({
            documentId: existing.documentId,
            data: {
              progress_status: "Completed",
              completed_at: now,
              certificate_issued: true,
            },
            status: 'published',
          });
        } else {
          await strapi.db.query(uid).update({
            where: { id: existing.id },
            data: {
              progress_status: "Completed",
              completed_at: now,
              certificate_issued: true,
            },
          });
        }
      } catch (err) {
        strapi.log.error('finalizeCourse update failed:', err?.message);
        await strapi.db.query(uid).update({
          where: { id: existing.id },
          data: {
            progress_status: "Completed",
            completed_at: now,
            certificate_issued: true,
          },
        });
      }
    } else {
      try {
        await strapi.documents(uid).create({
          data: {
            user: { connect: [{ id: numUserId }] },
            course: { connect: [{ id: numCourseId }] },
            progress_status: "Completed",
            progress_percentage: 100,
            completed_modules: [],
            completed_at: now,
            last_accessed_at: now,
            time_spent_minutes: 0,
            certificate_issued: true,
          },
          status: 'published',
        });
      } catch (createErr) {
        strapi.log.warn('finalizeCourse documents create failed:', createErr?.message);
        await strapi.db.query(uid).create({
          data: {
            user: numUserId,
            course: numCourseId,
            progress_status: "Completed",
            progress_percentage: 100,
            completed_modules: [],
            completed_at: now,
            last_accessed_at: now,
            time_spent_minutes: 0,
            certificate_issued: true,
          },
        });
      }
    }
  },

}));