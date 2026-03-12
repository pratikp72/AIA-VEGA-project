"use strict";

const { createCoreController } = require("@strapi/strapi").factories;
function _computeNextStep(completedCount, totalModules, course) {
  if (!course || completedCount < totalModules) return 'continue';
  const quizCompulsory = course.quiz?.[0]?.compulsory ?? false;
  const feedbackCompulsory = course.feedback?.[0]?.compulsory ?? false;
  if (quizCompulsory) return 'quiz_required';
  if (feedbackCompulsory) return 'feedback_required';
  return 'course_complete_allowed';
}

async function resolveCourseId(strapi, courseId) {
  const num = Number(courseId);
  if (!Number.isNaN(num)) return num;
  const course = await strapi.documents('api::course.course').findFirst({
    filters: { documentId: { $eq: String(courseId) } },
  });
  return course?.id ?? null;
}


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
    const numUserId = Number(userId);
    const numCourseId = Number(courseId);
    const now = new Date();

    // Check if progress exists
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
      existing = await strapi.db.query(uid).findOne({
        where: { user: numUserId, course: numCourseId },
      });
    }

    // If already exists → prevent language changes
    if (existing) {
      if (existing.language_selected && existing.language_selected !== language) {
        return ctx.badRequest("Language cannot be changed after starting the course.");
      }

      try {
        if (existing.documentId) {
          await strapi.documents(uid).update({
            documentId: existing.documentId,
            data: { progress_status: "In_progress", last_accessed_at: now },
            status: 'published',
          });
        } else {
          await strapi.db.query(uid).update({
            where: { id: existing.id },
            data: { progress_status: "In_progress", last_accessed_at: now },
          });
        }
      } catch (e) {
        await strapi.db.query(uid).update({
          where: { id: existing.id },
          data: { progress_status: "In_progress", last_accessed_at: now },
        });
      }

      return ctx.send({
        message: "Course already started; progress updated.",
      });
    }

    // Create new entry
    let entry;
    try {
      entry = await strapi.documents(uid).create(/** @type {any} */ ({
        data: {
          user: { connect: [{ id: numUserId }] },
          course: { connect: [{ id: numCourseId }] },
          progress_status: "In_progress",
          progress_percentage: 0,
          completed_modules: [],
          language_selected: language,
          started_at: now,
          last_accessed_at: now,
          time_spent_minutes: 0,
          certificate_issued: false,
        },
        status: 'published',
      }));
    } catch (createErr) {
      strapi.log.warn('startCourse documents create failed, trying db.query:', createErr?.message);
      entry = await strapi.db.query(uid).create({
        data: {
          user: numUserId,
          course: numCourseId,
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
    }

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
    const b = ctx.request.body || {};
    const { userId, courseId, moduleId } = b;
    const lastAccessedAt = b.last_accessed_at ? new Date(b.last_accessed_at) : new Date();
    const deltaMinutes = Math.max(0, Number(b.time_spent_minutes ?? 0));
    const selectedLanguage = b.selected_language ?? null;
    const startedAtFromReq = b.started_at ? new Date(b.started_at) : null;

    if (!userId || !courseId || !moduleId) {
      return ctx.badRequest("userId, courseId, moduleId required");
    }

    const uid = "api::user-progress.user-progress";
    const numUserId = Number(userId);
    const numCourseId = await resolveCourseId(strapi, courseId);
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
      // Fetch course first so we can compute percentage and nextStep
      const course = await strapi.db.query("api::course.course").findOne({
        where: { id: numCourseId },
        populate: { modules: true, quiz: true, feedback: true },
      });
      const totalModules = Array.isArray(course?.modules) ? course.modules.length : 0;
      const completedArr = [String(moduleId)];
      const pct = totalModules > 0 ? Math.round((completedArr.length / totalModules) * 100) : 0;
      const newStatus = pct >= 100 ? 'Completed' : 'In_progress';
      try {
        progress = await strapi.documents(uid).create(/** @type {any} */ ({
          data: {
            user: { connect: [{ id: numUserId }] },
            course: { connect: [{ id: numCourseId }] },
            progress_status: newStatus,
            progress_percentage: pct,
            completed_modules: completedArr,
            started_at: startedAtFromReq || lastAccessedAt,
            completed_at: newStatus === 'Completed' ? lastAccessedAt : null,
            last_accessed_at: lastAccessedAt,
            time_spent_minutes: deltaMinutes,
            certificate_issued: false,
            selected_language: selectedLanguage,
          },
          status: 'published',
        }));
      } catch (createErr) {
        strapi.log.warn('markModuleRead documents create failed, trying db.query:', createErr?.message);
        progress = await strapi.db.query(uid).create({
          data: {
            user: numUserId,
            course: numCourseId,
            progress_status: newStatus,
            progress_percentage: pct,
            completed_modules: completedArr,
            started_at: startedAtFromReq || lastAccessedAt,
            completed_at: newStatus === 'Completed' ? lastAccessedAt : null,
            last_accessed_at: lastAccessedAt,
            time_spent_minutes: deltaMinutes,
            certificate_issued: false,
            selected_language: selectedLanguage,
          },
        });
      }
      return ctx.send({
        message: 'Module marked completed',
        completed_modules: completedArr,
        nextStep: _computeNextStep(completedArr.length, totalModules, course),
        progress,
      });
    }

    // Existing row — fetch course, compute updated values
    const course = await strapi.db.query("api::course.course").findOne({
      where: { id: numCourseId },
      populate: { modules: true, quiz: true, feedback: true },
    });

    if (!course) {
      return ctx.send({
        message: "Module marked completed",
        completed_modules: [String(moduleId)],
        nextStep: "continue",
      });
    }

    const totalModules = Array.isArray(course.modules) ? course.modules.length : 0;

    // Dedupe and compute new state
    const completedSet = new Set((progress.completed_modules || []).map(String));
    completedSet.add(String(moduleId));
    const completedArr2 = [...completedSet];
    const pct2 = totalModules > 0 ? Math.round((completedArr2.length / totalModules) * 100) : progress.progress_percentage || 0;
    const newStatus2 = pct2 >= 100 ? 'Completed' : (completedArr2.length > 0 ? 'In_progress' : 'Not_started');
    const newTime = Math.max(0, Number(progress.time_spent_minutes || 0)) + deltaMinutes;
    const completedAt = newStatus2 === 'Completed' ? (progress.completed_at || lastAccessedAt) : null;

    const updateData = /** @type {any} */ ({
      completed_modules: completedArr2,
      progress_percentage: pct2,
      progress_status: newStatus2,
      started_at: progress.started_at || startedAtFromReq || lastAccessedAt,
      completed_at: completedAt,
      last_accessed_at: lastAccessedAt,
      time_spent_minutes: newTime,
      selected_language: selectedLanguage ?? progress.selected_language ?? null,
    });

    try {
      if (progress.documentId) {
        progress = await strapi.documents(uid).update(/** @type {any} */ ({
          documentId: progress.documentId,
          data: updateData,
          status: 'published',
        }));
      } else {
        progress = await strapi.db.query(uid).update({
          where: { id: progress.id },
          data: updateData,
        });
      }
    } catch (updateErr) {
      strapi.log.warn('markModuleRead update failed:', updateErr?.message);
      progress = await strapi.db.query(uid).update({
        where: { id: progress.id },
        data: updateData,
      });
    }

    return ctx.send({
      message: "Module marked completed",
      completed_modules: completedArr2,
      nextStep: _computeNextStep(completedArr2.length, totalModules, course),
      progress,
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
      const courseId = r.course?.id ?? r.course;
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
    const numCourseId = await resolveCourseId(strapi, courseId);
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
      return ctx.send({
        progress_status: 'Not_started',
        progress_percentage: 0,
        completed_modules: [],
        started_at: null,
        completed_at: null,
        last_accessed_at: null,
        time_spent_minutes: 0,
        certificate_issued: false,
        certificate_url: null,
        selected_language: null,
        course: null,
        user: null,
        quiz_submission: null,
        feedback_submission: null,
      });
    }
    // Re-fetch with full population via db.query for complete field set
    let full = null;
    try {
      full = await strapi.db.query('api::user-progress.user-progress').findOne({
        where: { id: progress.id },
        populate: {
          course: true,
          user: true,
          quiz_submission: true,
          feedback_submission: true,
        },
      });
    } catch (e) {
      full = progress;
    }
    return ctx.send({
      id: full.id,
      documentId: full.documentId ?? null,
      progress_status: full.progress_status,
      progress_percentage: full.progress_percentage ?? 0,
      completed_modules: Array.isArray(full.completed_modules) ? full.completed_modules : [],
      started_at: full.started_at ?? null,
      completed_at: full.completed_at ?? null,
      last_accessed_at: full.last_accessed_at ?? null,
      time_spent_minutes: full.time_spent_minutes ?? 0,
      certificate_issued: !!full.certificate_issued,
      certificate_url: full.certificate_url ?? null,
      selected_language: full.selected_language ?? null,
      course: full.course ?? null,
      user: full.user ?? null,
      quiz_submission: full.quiz_submission ?? null,
      feedback_submission: full.feedback_submission ?? null,
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
    const numCourseId = await resolveCourseId(strapi, courseId);
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
        await strapi.documents(uid).create(/** @type {any} */ ({
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
        }));
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