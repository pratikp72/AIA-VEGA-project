'use strict';

/**
 * Automatic user-progress and course-assignment creation and updates:
 *
 * 1. When a course assignment is created:
 *    - Resolve assigned users by assignment_target_type (Department / Company / Individual / Location).
 *    - Create user-progress with progress_status "Not_started" for each assigned user.
 *    - When target is Department, Company, or Location: also create one Individual-type
 *      course-assignment per user (same course, due_date, active) so each user has an explicit
 *      entry in the course-assignment schema. (Skip when target is already Individual.)
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
  if (course == null) return null;
  if (typeof course === 'number' && !Number.isNaN(course)) return course;
  if (typeof course === 'string' && course.length > 0) return course;
  return course.id ?? course.documentId ?? course.document_id ?? null;
}

const COURSE_UID = 'api::course.course';
/** Resolve course id for DB writes (relations usually need numeric id). */
async function resolveCourseIdForDb(strapi, courseId) {
  if (courseId == null) return null;
  const n = Number(courseId);
  if (!Number.isNaN(n) && n > 0) return n;
  if (typeof courseId === 'string' && courseId.length > 10) {
    const row = await strapi.db.query(COURSE_UID).findOne({ where: { documentId: courseId }, select: ['id'] });
    return row?.id ?? null;
  }
  return courseId;
}

/**
 * Resolve user IDs from the create payload (params.data) so we don't depend on relations being populated when re-loading.
 * Use this first when event.params.data is available (e.g. Content Manager create).
 */
async function getAssignedUserIdsFromParams(strapi, params, result) {
  const data = params?.data;
  if (!data) {
    strapi.log.debug('user-progress-automation: getAssignedUserIdsFromParams no params.data');
    return null;
  }
  const targetType = data.assignment_target_type;
  if (!targetType) {
    strapi.log.warn('user-progress-automation: getAssignedUserIdsFromParams no assignment_target_type');
    return null;
  }
  const doc = result?.document ?? result;
  let courseId = getCourseId(data.course) ?? getCourseId(doc?.course) ?? getCourseId(result?.course)
    ?? doc?.course_id ?? result?.course_id;
  if (courseId == null && data.course != null) {
    const c = data.course;
    if (typeof c === 'object') {
      courseId = c.id ?? c.documentId ?? c.document_id;
      if (courseId == null && c.connect && Array.isArray(c.connect) && c.connect[0])
        courseId = c.connect[0].id ?? c.connect[0].documentId ?? c.connect[0].document_id;
    } else {
      courseId = c;
    }
  }
  if (!courseId) {
    strapi.log.warn('user-progress-automation: getAssignedUserIdsFromParams no courseId', { hasCourseInData: !!data.course, hasCourseInResult: !!result?.course });
    return null;
  }

  let userIds = [];
  if (targetType === 'Individual') {
    const raw = data.individual_user ?? data.individual_user_id;
    const arr = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
    userIds = arr.map((u) => (u && typeof u === 'object' ? getUserId(u) : u)).filter(Boolean);
  } else if (targetType === 'Department') {
    const raw = data.departments ?? data.departments_id;
    const deptIds = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
    const ids = deptIds.map((d) => (d && typeof d === 'object' ? (d.id ?? d.documentId) : d)).filter(Boolean);
    if (ids.length > 0) {
      const depts = await strapi.db.query('api::department.department').findMany({
        where: { id: { $in: ids.map(Number) } },
        select: ['name'],
      });
      const deptNames = (depts || []).map((d) => d.name).filter(Boolean);
      if (deptNames.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { department: { $in: deptNames }, blocked: false },
          select: ['id'],
        });
        userIds = (users || []).map((u) => u.id).filter(Boolean);
      }
    }
  } else if (targetType === 'Company') {
    const raw = data.companies;
    let companyIds = [];
    if (Array.isArray(raw)) {
      companyIds = raw.map((c) => (c && typeof c === 'object' ? (c.id ?? c.documentId) : c)).filter(Boolean);
    } else if (raw && typeof raw === 'object') {
      const arr = raw.set ?? raw.connect ?? raw.disconnect;
      if (Array.isArray(arr)) companyIds = arr.map((c) => (c && typeof c === 'object' ? (c.id ?? c.documentId) : c)).filter(Boolean);
      else if (raw.id != null) companyIds = [raw.id];
      else if (raw.documentId != null) companyIds = [raw.documentId];
    } else if (raw != null) {
      companyIds = Array.isArray(raw) ? raw : [typeof raw === 'object' ? (raw.id ?? raw.documentId) : raw];
    }
    if (companyIds.length > 0) {
      const numericIds = companyIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x))).map(Number);
      const docIds = companyIds.filter((x) => typeof x === 'string' && x.length > 10);
      let companies = [];
      if (numericIds.length > 0) {
        const byId = await strapi.db.query('api::company.company').findMany({
          where: { id: { $in: numericIds } },
          select: ['name'],
        });
        companies = companies.concat(byId || []);
      }
      if (docIds.length > 0) {
        const byDocId = await strapi.db.query('api::company.company').findMany({
          where: { documentId: { $in: docIds } },
          select: ['name'],
        });
        (byDocId || []).forEach((c) => { if (c && !companies.some((x) => x && x.name === c.name)) companies.push(c); });
      }
      let companyNames = companies.map((c) => c.name).filter(Boolean);
      if (companyNames.length === 0 && result) {
        const fromResult = Array.isArray(result.companies) ? result.companies : (result.companies ? [result.companies] : []);
        companyNames = fromResult.map((c) => c?.name ?? c?.attributes?.name).filter(Boolean);
      }
      for (const name of companyNames) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { company: name, blocked: false },
          select: ['id'],
        });
        (users || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
      }
    }
  } else if (targetType === 'Location') {
    const raw = data.unit_locations ?? data.unit_locations_id;
    const locIds = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
    const ids = locIds.map((l) => (l && typeof l === 'object' ? (l.id ?? l.documentId) : l)).filter(Boolean);
    if (ids.length > 0) {
      const locs = await strapi.db.query('api::unit-location.unit-location').findMany({
        where: { id: { $in: ids.map(Number) } },
        select: ['name'],
      });
      const locationNames = (locs || []).map((l) => l.name).filter(Boolean);
      if (locationNames.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { working_location: { $in: locationNames }, blocked: false },
          select: ['id'],
        });
        userIds = (users || []).map((u) => u.id).filter(Boolean);
      }
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIdsFromParams', { targetType, userIdsCount: userIds.length });
  return {
    courseId,
    userIds,
    due_date: data.due_date ?? result?.due_date,
    active: data.active !== false,
    targetType,
  };
}

/**
 * Load a course-assignment by id or documentId (Strapi 5 may return either from create).
 */
async function loadAssignment(strapi, assignmentId) {
  if (assignmentId == null || assignmentId === '') return null;
  let assignment = null;
  const isNumeric = typeof assignmentId === 'number' || (typeof assignmentId === 'string' && /^\d+$/.test(assignmentId));
  if (isNumeric) {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { id: Number(assignmentId) },
      populate: { course: true, individual_user: true, departments: true, companies: true, unit_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { documentId: assignmentId },
      populate: { course: true, individual_user: true, departments: true, companies: true, unit_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    try {
      const doc = await strapi.documents(COURSE_ASSIGNMENT_UID).findOne({
        documentId: assignmentId,
        populate: { course: true, individual_user: true, departments: true, companies: true, unit_locations: true },
      });
      if (doc) assignment = doc;
    } catch (_) {}
  }
  return assignment;
}

/**
 * Resolve list of user IDs from a course assignment (after it is created and we have id/documentId).
 * - Individual: only selected users (individual_user).
 * - Department: all users in the selected departments (user.department string matches dept name).
 * - Company: all users with that company (user.company enum: AIA / Vega).
 * - Location: all users whose working_location matches one of the assignment's unit_locations (by name).
 */
async function getAssignedUserIds(strapi, assignmentId) {
  const assignment = await loadAssignment(strapi, assignmentId);
  if (!assignment || !assignment.course) {
    strapi.log.warn('user-progress-automation: assignment not found or no course', { assignmentId });
    return { courseId: null, userIds: [], due_date: null, active: true, targetType: null };
  }
  const courseId = getCourseId(assignment.course);
  if (!courseId) return { courseId: null, userIds: [], due_date: assignment.due_date, active: assignment.active, targetType: assignment.assignment_target_type };

  const targetType = assignment.assignment_target_type;
  let userIds = [];

  if (targetType === 'Individual' && Array.isArray(assignment.individual_user)) {
    userIds = assignment.individual_user.map(getUserId).filter(Boolean);
  } else if (targetType === 'Department' && Array.isArray(assignment.departments)) {
    const deptNames = assignment.departments.map((d) => d?.name).filter(Boolean);
    if (deptNames.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { department: { $in: deptNames }, blocked: false },
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  } else if (targetType === 'Company') {
    const companies = Array.isArray(assignment.companies) ? assignment.companies : (assignment.companies ? [assignment.companies] : []);
    const companyNames = companies.map((c) => (c && (c.name != null ? c.name : c.attributes?.name))).filter(Boolean);
    if (companyNames.length > 0) {
      try {
        const orConditions = companyNames.map((name) => ({ company: name }));
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { $or: orConditions, blocked: false },
          select: ['id'],
        });
        userIds = (users || []).map((u) => u.id).filter(Boolean);
      } catch (e) {
        try {
          const users = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: { company: companyNames[0], blocked: false },
            select: ['id'],
          });
          userIds = (users || []).map((u) => u.id).filter(Boolean);
          if (companyNames.length > 1) {
            for (let i = 1; i < companyNames.length; i++) {
              const more = await strapi.db.query('plugin::users-permissions.user').findMany({
                where: { company: companyNames[i], blocked: false },
                select: ['id'],
              });
              (more || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
            }
          }
        } catch (e2) {
          strapi.log.warn('user-progress-automation: Company user query failed', e2?.message || e2);
        }
      }
    }
  } else if (targetType === 'Location' && Array.isArray(assignment.unit_locations) && assignment.unit_locations.length > 0) {
    const locationNames = assignment.unit_locations.map((l) => l?.name).filter(Boolean);
    if (locationNames.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { working_location: { $in: locationNames }, blocked: false },
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIds', { assignmentId, targetType, userIdsCount: userIds.length });
  return {
    courseId,
    userIds,
    due_date: assignment.due_date,
    active: assignment.active,
    targetType,
  };
}

/**
 * Create one Individual-type course-assignment per user (same course, due_date, active).
 * Uses Document Service so entries appear in admin and have documentId (Strapi 5).
 */
async function createCourseAssignmentEntries(strapi, courseId, userIds, dueDate, active) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  const due = dueDate instanceof Date ? dueDate : (dueDate ? new Date(dueDate) : new Date());
  const isActive = active !== false;
  let existingUserIds = new Set();
  try {
    const existing = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: { assignment_target_type: 'Individual', course: courseId },
      populate: { individual_user: true },
      limit: 10000,
    });
    (existing || []).forEach((a) => {
      const users = Array.isArray(a?.individual_user) ? a.individual_user : (a?.individual_user ? [a.individual_user] : []);
      users.forEach((u) => {
        const id = u?.id ?? u?.documentId;
        if (id != null) existingUserIds.add(Number(id));
      });
    });
  } catch (_) {}
  const docService = strapi.documents(COURSE_ASSIGNMENT_UID);
  let created = 0;
  for (const userId of userIds) {
    if (existingUserIds.has(Number(userId))) continue;
    try {
      await docService.create({
        data: {
          assignment_target_type: 'Individual',
          course: courseId,
          due_date: due,
          active: isActive,
          individual_user: [userId],
        },
        status: 'published',
      });
      created++;
    } catch (e) {
      strapi.log.warn('createCourseAssignmentEntries failed (userId=%s):', userId, e?.message || String(e));
    }
  }
  if (created > 0) strapi.log.info('user-progress-automation: created %d individual course-assignment entries', created);
}

/**
 * Create user-progress (Not_started) for each user. Uses Document Service so entries appear in admin (Strapi 5).
 */
async function createUserProgressEntries(strapi, courseId, userIds) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  userIds = [...new Set(userIds)]; // one user-progress per user per course
  const now = new Date();
  const docService = strapi.documents(USER_PROGRESS_UID);
  let created = 0;
  for (const userId of userIds) {
    try {
      let existing = null;
      try {
        existing = await docService.findFirst({
          filters: { user: { id: userId }, course: { id: courseId } },
          status: 'published',
        });
      } catch (_) {
        existing = await strapi.db.query(USER_PROGRESS_UID).findOne({
          where: { user: userId, course: courseId },
        });
      }
      if (existing) continue;
    } catch (_) {}
    try {
      await docService.create({
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
        status: 'published',
      });
      created++;
    } catch (e) {
      strapi.log.warn('createUserProgressEntries failed (userId=%s):', userId, e?.message || String(e));
    }
  }
  if (created > 0) strapi.log.info('user-progress-automation: created %d user-progress entries', created);
}

/**
 * Subscribe to course-assignment afterCreate and quiz-submission afterCreate.
 */
function registerUserProgressLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [COURSE_ASSIGNMENT_UID],
    async afterCreate(event) {
      try {
        const { result, params = {} } = event;
        // Skip when the created assignment is Individual: those are our own child entries from
        // createCourseAssignmentEntries. Running automation for them would create duplicate user-progress.
        if (result?.assignment_target_type === 'Individual') return;
        const assignmentId = result.id ?? result.documentId;
        let payload = null;
        if (params.data) {
          payload = await getAssignedUserIdsFromParams(strapi, params, result);
        }
        if (!payload || !payload.userIds || payload.userIds.length === 0) {
          if (assignmentId == null) {
            strapi.log.warn('user-progress-automation: afterCreate no id/documentId', result);
            return;
          }
          await new Promise((r) => setTimeout(r, 200));
          payload = await getAssignedUserIds(strapi, assignmentId);
        }
        let { courseId, userIds, due_date, active, targetType } = payload || {};
        if (!courseId || !userIds || userIds.length === 0) return;
        userIds = [...new Set(userIds)]; // dedupe so we never create more than one user-progress per user
        courseId = await resolveCourseIdForDb(strapi, courseId);
        if (!courseId) return;
        await createUserProgressEntries(strapi, courseId, userIds);
        if (targetType !== 'Individual') {
          await createCourseAssignmentEntries(strapi, courseId, userIds, due_date, active);
        }
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

/**
 * Process course-assignment right after create (called from Document Service middleware with params + result).
 * Use this when creating from Content Manager so we get the exact params.data (companies, course, etc.).
 */
async function processCourseAssignmentCreate(strapi, params, result) {
  strapi.log.info('user-progress-automation: processCourseAssignmentCreate called');
  try {
    const doc = result?.document ?? result;
    const data = params?.data;
    let payload = null;
    if (data) {
      payload = await getAssignedUserIdsFromParams(strapi, { data }, doc);
    }
    if (!payload || !payload.userIds || payload.userIds.length === 0) {
      const assignmentId = doc?.id ?? doc?.documentId;
      strapi.log.info('user-progress-automation: no users from params, trying fallback load', { assignmentId, hasData: !!data });
      if (assignmentId != null) {
        await new Promise((r) => setTimeout(r, 300));
        payload = await getAssignedUserIds(strapi, assignmentId);
      }
    }
    let { courseId, userIds, due_date, active, targetType } = payload || {};
    if (!courseId || !userIds || userIds.length === 0) {
      strapi.log.warn('user-progress-automation: no users to create entries for', { courseId, userIdsCount: userIds?.length ?? 0, targetType });
      return;
    }
    userIds = [...new Set(userIds)]; // one user-progress per user
    courseId = await resolveCourseIdForDb(strapi, courseId);
    if (!courseId) {
      strapi.log.warn('user-progress-automation: could not resolve courseId for DB');
      return;
    }
    strapi.log.info('user-progress-automation: creating entries (%d users, courseId=%s, targetType=%s)', userIds.length, courseId, targetType);
    await createUserProgressEntries(strapi, courseId, userIds);
    if (targetType !== 'Individual') {
      await createCourseAssignmentEntries(strapi, courseId, userIds, due_date, active);
    }
    strapi.log.info('user-progress-automation: processCourseAssignmentCreate done');
  } catch (e) {
    strapi.log.error('user-progress-automation processCourseAssignmentCreate:', e?.message || e);
  }
}

module.exports = { registerUserProgressLifecycles, processCourseAssignmentCreate };
