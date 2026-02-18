'use strict';

/**
 * Automatic user-progress creation and updates:
 *
 * 1. When a course assignment is created → create user-progress with progress_status "Not_started"
 *    for each assigned user (Individual: individual_user; Department: users in those departments).
 *
 * 2. When a quiz submission is created → update the corresponding user-progress to
 *    "Completed" (if passed) or "Failed" (if not passed); set completed_at and progress_percentage.
 */

const USER_PROGRESS_UID = 'api::user-progress.user-progress';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';

function getUserId(user) {
  if (!user) return null;
  return user.id ?? user.documentId ?? user.document_id;
}

function getCourseId(course) {
  if (!course) return null;
  return course.id ?? course.documentId ?? course.document_id;
}

/**
 * Resolve list of user IDs from a course assignment (after it is created and we have id).
 */
async function getAssignedUserIds(strapi, assignmentId) {
  const assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
    where: { id: assignmentId },
    populate: {
      course: true,
      individual_user: true,
      departments: true,
    },
  });
  if (!assignment || !assignment.course) return { courseId: null, userIds: [] };
  const courseId = getCourseId(assignment.course);
  if (!courseId) return { courseId: null, userIds: [] };

  const targetType = assignment.assignment_target_type;
  let userIds = [];

  if (targetType === 'Individual' && Array.isArray(assignment.individual_user)) {
    userIds = assignment.individual_user.map(getUserId).filter(Boolean);
  } else if (targetType === 'Department' && Array.isArray(assignment.departments)) {
    const deptNames = assignment.departments.map((d) => d?.name).filter(Boolean);
    if (deptNames.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { department: { $in: deptNames }, blocked: false },
        attributes: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  }
  // Role / Location: could be extended (e.g. users where role matches assignment.role)

  return { courseId, userIds };
}

async function createUserProgressEntries(strapi, courseId, userIds) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  const now = new Date();
  for (const userId of userIds) {
    const existing = await strapi.db.query(USER_PROGRESS_UID).findOne({
      where: { user: userId, course: courseId },
    });
    if (existing) continue;
    const entry = await strapi.db.query(USER_PROGRESS_UID).create({
      data: {
        user: userId,
        course: courseId,
        progress_status: 'Not_started',
        progress_percentage: 0,
        completed_modules: [],
        last_accessed_at: now,
        time_spent_minutes: 0,
        certificate_issued: false,
      },
    });
    const documentId = entry.documentId ?? entry.document_id ?? entry.id;
    if (documentId && typeof strapi.documents(USER_PROGRESS_UID).publish === 'function') {
      try {
        await strapi.documents(USER_PROGRESS_UID).publish({ documentId });
      } catch (_) {}
    }
  }
}

/**
 * Subscribe to course-assignment afterCreate and quiz-submission afterCreate.
 */
function registerUserProgressLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [COURSE_ASSIGNMENT_UID],
    async afterCreate(event) {
      try {
        const { result } = event;
        const assignmentId = result.id;
        const { courseId, userIds } = await getAssignedUserIds(strapi, assignmentId);
        await createUserProgressEntries(strapi, courseId, userIds);
      } catch (e) {
        strapi.log.error('user-progress-automation (course-assignment afterCreate):', e?.message || e);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [QUIZ_SUBMISSION_UID],
    async afterCreate(event) {
      try {
        const { result } = event;
        const userId = getUserId(result.submitted_by) ?? result.submitted_by_id;
        const courseId = getCourseId(result.course) ?? result.course_id;
        const passed = result.passed === true;
        if (!userId || !courseId) return;
        const progress = await strapi.db.query(USER_PROGRESS_UID).findOne({
          where: { user: userId, course: courseId },
        });
        if (!progress) return;
        const now = new Date();
        await strapi.db.query(USER_PROGRESS_UID).update({
          where: { id: progress.id },
          data: {
            progress_status: passed ? 'Completed' : 'Failed',
            progress_percentage: passed ? 100 : (progress.progress_percentage ?? 0),
            completed_at: now,
          },
        });
      } catch (e) {
        strapi.log.error('user-progress-automation (quiz-submission afterCreate):', e?.message || e);
      }
    },
  });

  strapi.log.info('User-progress automation: course-assignment → Not_started; quiz-submission → Completed/Failed');
}

module.exports = { registerUserProgressLifecycles };
