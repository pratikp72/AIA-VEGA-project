'use strict';

const USER_PROGRESS_UID = 'api::user-progress.user-progress';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';

let _creatingSubEntries = false;

function getUserId(user) {
  if (!user) return null;
  return user.id ?? user.documentId ?? user.document_id;
}

function getCourseId(course) {
  if (course == null) return null;
  if (Array.isArray(course)) return course.length > 0 ? getCourseId(course[0]) : null;
  if (typeof course === 'number' && !Number.isNaN(course)) return course;
  if (typeof course === 'string' && course.length > 0) return course;
  return course.id ?? course.documentId ?? course.document_id ?? null;
}

function getAllCourseIds(courses) {
  if (courses == null) return [];
  if (Array.isArray(courses)) {
    return courses.map(getCourseId).filter(Boolean);
  }
  const single = getCourseId(courses);
  return single ? [single] : [];
}

function extractRelationIds(raw) {
  if (raw == null) return [];
  if (typeof raw === 'number') return [raw];
  if (typeof raw === 'string') return raw.length > 0 ? [raw] : [];
  if (Array.isArray(raw)) {
    return raw.map((item) => (item && typeof item === 'object' ? (item.id ?? item.documentId) : item)).filter(Boolean);
  }
  if (typeof raw === 'object') {
    const arr = Array.isArray(raw.connect) ? raw.connect : Array.isArray(raw.set) ? raw.set : (raw.id != null ? [raw] : []);
    return arr.map((item) => (item && typeof item === 'object' ? (item.id ?? item.documentId) : item)).filter(Boolean);
  }
  return [];
}

const COURSE_UID = 'api::course.course';
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

function normalizeCompanyName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (lower === 'aia') return 'AIA';
  if (lower === 'vega') return 'Vega';
  return String(name || '').trim();
}

function extractCompanyNamesFromEntity(raw) {
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return [...new Set(items.map((item) => item?.name ?? item?.attributes?.name).filter(Boolean).map(normalizeCompanyName))];
}

async function resolveCompanyNames(strapi, rawCompany, fallbackCompany) {
  const relationIds = extractRelationIds(rawCompany);
  const numericIds = relationIds
    .filter((value) => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(String(value))))
    .map(Number);
  const docIds = relationIds.filter((value) => typeof value === 'string' && value.length > 10);

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
    (byDocId || []).forEach((company) => {
      if (company?.name && !companies.some((item) => item?.name === company.name)) companies.push(company);
    });
  }

  const names = companies.map((company) => normalizeCompanyName(company?.name)).filter(Boolean);
  if (names.length > 0) return [...new Set(names)];
  return extractCompanyNamesFromEntity(fallbackCompany);
}

function scopeUserWhere(where, companyNames) {
  if (!Array.isArray(companyNames) || companyNames.length === 0) return where;
  if (companyNames.length === 1) {
    return { ...where, company: companyNames[0] };
  }
  return {
    $and: [
      where,
      { $or: companyNames.map((name) => ({ company: name })) },
    ],
  };
}

async function getAssignedUserIdsFromParams(strapi, params, result) {
  const data = params?.data;
  if (!data) {
    strapi.log.debug('user-progress-automation: getAssignedUserIdsFromParams no params.data');
    return null;
  }
  const targetType = data.assignment_target_type || 'Company';
  const doc = result?.document ?? result;
  let courseId = getCourseId(data.courses) ?? getCourseId(data.course) ??
    getCourseId(doc?.courses) ?? getCourseId(doc?.course) ??
    getCourseId(result?.courses) ?? getCourseId(result?.course) ??
    doc?.course_id ?? result?.course_id;
  if (courseId == null) {
    const courseRaw = data.courses ?? data.course;
    if (courseRaw != null) {
      const ids = extractRelationIds(courseRaw);
      if (ids.length > 0) courseId = ids[0];
    }
  }
  let courseIds = [];
  {
    const courseRaw = data.courses ?? data.course;
    if (courseRaw != null) {
      const relIds = extractRelationIds(courseRaw);
      if (relIds.length > 0) courseIds = relIds;
    }
    if (courseIds.length === 0) {
      const fromResult = getAllCourseIds(doc?.courses) || getAllCourseIds(doc?.course) ||
        getAllCourseIds(result?.courses) || getAllCourseIds(result?.course);
      if (fromResult && fromResult.length > 0) courseIds = fromResult;
    }
    if (courseIds.length === 0 && courseId) courseIds = [courseId];
    if (!courseId && courseIds.length > 0) courseId = courseIds[0];
  }

  if (!courseId) {
    strapi.log.warn('user-progress-automation: getAssignedUserIdsFromParams no courseId', { hasCourseInData: !!data.course, hasCourseInResult: !!result?.course });
    return null;
  }

  const companyNames = await resolveCompanyNames(strapi, data.company ?? data.companies, result?.company ?? result?.companies);

  let userIds = [];
  if (targetType === 'Individual') {
    const raw = data.individual_user ?? data.individual_user_id;
    const extracted = extractRelationIds(raw);
    const numericIds = [];
    const docIds = [];
    for (const id of extracted) {
      if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(String(id)))) {
        numericIds.push(Number(id));
      } else if (typeof id === 'string' && id.length > 0) {
        docIds.push(id);
      }
    }
    if (docIds.length > 0) {
      try {
        const resolved = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { documentId: { $in: docIds } },
          select: ['id'],
        });
        (resolved || []).forEach((u) => { if (u.id) numericIds.push(u.id); });
      } catch (e) {
        strapi.log.warn('user-progress-automation: failed to resolve user documentIds', e?.message || e);
      }
    }

    if (companyNames.length > 0 && numericIds.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ id: { $in: [...new Set(numericIds)] }, blocked: { $ne: true } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    } else {
      userIds = [...new Set(numericIds)];
    }
  } else if (targetType === 'Department') {
    const ids = extractRelationIds(data.departments ?? data.departments_id);
    if (ids.length > 0) {
      const depts = await strapi.db.query('api::department.department').findMany({
        where: { id: { $in: ids.map(Number) } },
        select: ['name'],
      });
      const deptNames = (depts || []).map((d) => d.name).filter(Boolean);
      if (deptNames.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: scopeUserWhere({ department: { $in: deptNames }, blocked: { $ne: true } }, companyNames),
          select: ['id'],
        });
        userIds = (users || []).map((u) => u.id).filter(Boolean);
      }
    }
  } else if (targetType === 'Location') {
    const ids = extractRelationIds(data.work_locations ?? data.unit_locations ?? data.work_locations_id ?? data.unit_locations_id);
    if (ids.length > 0) {
      const locs = await strapi.db.query('api::work-location.work-location').findMany({
        where: { id: { $in: ids.filter((x) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number) } },
        select: ['name'],
      });
      const locationNames = (locs || []).map((l) => l.name).filter(Boolean);
      if (locationNames.length > 0) {
        const includeVega = companyNames.length === 0 || companyNames.includes('Vega');
        const includeAia = companyNames.length === 0 || companyNames.includes('AIA');
        const userLists = await Promise.all([
          includeVega
            ? strapi.db.query('plugin::users-permissions.user').findMany({
              where: { company: 'Vega', working_location: { $in: locationNames }, blocked: { $ne: true } },
              select: ['id'],
            })
            : Promise.resolve([]),
          includeAia
            ? strapi.db.query('plugin::users-permissions.user').findMany({
              where: { company: 'AIA', branch: { $in: locationNames }, blocked: { $ne: true } },
              select: ['id'],
            })
            : Promise.resolve([]),
        ]);
        const idSet = new Set();
        userLists.flat().forEach((u) => { if (u?.id) idSet.add(u.id); });
        userIds = [...idSet];
      }
    }
  } else if (targetType === 'Company') {
    // No target type selected (or explicitly Company): assign to all users of the selected company
    if (companyNames.length > 0) {
      for (const name of companyNames) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { company: name, blocked: { $ne: true } },
          select: ['id'],
        });
        (users || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
      }
    } else {
      strapi.log.warn('user-progress-automation: Company fallback but no company resolved — skipping');
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIdsFromParams', { targetType, userIdsCount: userIds.length, courseIdsCount: courseIds.length });
  return {
    courseId,
    courseIds,
    userIds,
    due_date: data.due_date ?? result?.due_date,
    active: data.active !== false,
    targetType,
    company: data.company ?? result?.company,
  };
}

async function loadAssignment(strapi, assignmentId) {
  if (assignmentId == null || assignmentId === '') return null;
  let assignment = null;
  const isNumeric = typeof assignmentId === 'number' || (typeof assignmentId === 'string' && /^\d+$/.test(assignmentId));
  if (isNumeric) {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { id: Number(assignmentId) },
      populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { documentId: assignmentId },
      populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    try {
      const doc = await strapi.documents(COURSE_ASSIGNMENT_UID).findOne({
        documentId: assignmentId,
        populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
      });
      if (doc) assignment = doc;
    } catch (_) {}
  }
  return assignment;
}

async function getAssignedUserIds(strapi, assignmentId) {
  const assignment = await loadAssignment(strapi, assignmentId);
  if (!assignment) {
    strapi.log.warn('user-progress-automation: assignment not found', { assignmentId });
    return { courseId: null, userIds: [], due_date: null, active: true, targetType: null };
  }
  const coursesField = assignment.courses ?? assignment.course;
  if (!coursesField) {
    strapi.log.warn('user-progress-automation: assignment has no course', { assignmentId });
    return { courseId: null, courseIds: [], userIds: [], due_date: null, active: true, targetType: null };
  }
  const courseId = getCourseId(coursesField);
  const courseIds = getAllCourseIds(coursesField);
  if (!courseId) return { courseId: null, courseIds: [], userIds: [], due_date: assignment.due_date, active: assignment.active, targetType: assignment.assignment_target_type };

  const targetType = assignment.assignment_target_type || 'Company';
  const companyNames = await resolveCompanyNames(strapi, assignment.company ?? assignment.companies, assignment.company ?? assignment.companies);
  let userIds = [];

  if (targetType === 'Individual' && Array.isArray(assignment.individual_user)) {
    userIds = assignment.individual_user.map(getUserId).filter(Boolean);
    if (companyNames.length > 0 && userIds.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ id: { $in: userIds }, blocked: { $ne: true } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  } else if (targetType === 'Department' && Array.isArray(assignment.departments)) {
    const deptNames = assignment.departments.map((d) => d?.name).filter(Boolean);
    if (deptNames.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ department: { $in: deptNames }, blocked: { $ne: true } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  } else if (targetType === 'Location' && Array.isArray(assignment.work_locations ?? assignment.unit_locations) && (assignment.work_locations ?? assignment.unit_locations).length > 0) {
    const locationNames = (assignment.work_locations ?? assignment.unit_locations).map((l) => l?.name).filter(Boolean);
    if (locationNames.length > 0) {
      const includeVega = companyNames.length === 0 || companyNames.includes('Vega');
      const includeAia = companyNames.length === 0 || companyNames.includes('AIA');
      const userLists = await Promise.all([
        includeVega
          ? strapi.db.query('plugin::users-permissions.user').findMany({
            where: { company: 'Vega', working_location: { $in: locationNames }, blocked: { $ne: true } },
            select: ['id'],
          })
          : Promise.resolve([]),
        includeAia
          ? strapi.db.query('plugin::users-permissions.user').findMany({
            where: { company: 'AIA', branch: { $in: locationNames }, blocked: { $ne: true } },
            select: ['id'],
          })
          : Promise.resolve([]),
      ]);
      const idSet = new Set();
      userLists.flat().forEach((u) => { if (u?.id) idSet.add(u.id); });
      userIds = [...idSet];
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIds', { assignmentId, targetType, userIdsCount: userIds.length });
  // --- Company / no-target-type fallback already handled by targetType defaulting to 'Company' above.
  // The Individual / Department / Location branches won't match, so we add the Company branch here. ---
  if (userIds.length === 0 && targetType === 'Company' && companyNames.length > 0) {
    for (const name of companyNames) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { company: name, blocked: { $ne: true } },
        select: ['id'],
      });
      (users || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIds (final)', { assignmentId, targetType, userIdsCount: userIds.length, courseIdsCount: courseIds.length });
  return {
    courseId,
    courseIds,
    userIds,
    due_date: assignment.due_date,
    active: assignment.active,
    targetType,
    company: assignment.company,
  };
}

async function createCourseAssignmentEntries(strapi, courseId, userIds, dueDate, active, companyRaw) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  const due = dueDate instanceof Date ? dueDate : (dueDate ? new Date(dueDate) : new Date());
  const dueValue = due.toISOString().slice(0, 10);
  const activeValue = active === 'unpublished' ? 'unpublished' : 'published';
  
  const existingByUserId = new Map();
  try {
    const existing = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: { assignment_target_type: 'Individual', courses: { id: Number(courseId) } },
      populate: { individual_user: true },
      limit: 10000,
    });
    (existing || []).forEach((a) => {
      const users = Array.isArray(a?.individual_user) ? a.individual_user : (a?.individual_user ? [a.individual_user] : []);
      users.forEach((u) => {
        const keys = [];
        if (u?.id != null) keys.push(String(u.id));
        if (u?.documentId != null) keys.push(String(u.documentId));

        keys.forEach((key) => {
          const bucket = existingByUserId.get(key);
          if (bucket) {
            bucket.push(a);
          } else {
            existingByUserId.set(key, [a]);
          }
        });
      });
    });
  } catch (_) {}
  
  const docService = strapi.documents(COURSE_ASSIGNMENT_UID);
  let created = 0;
  let updated = 0;
  _creatingSubEntries = true;
  try {
    for (const userId of userIds) {
      const existingAssignments = existingByUserId.get(String(userId)) || [];
      
      if (existingAssignments.length > 0) {
        // Update due_date instead of skipping
        try {
          const seen = new Set();
          for (const existingAssignment of existingAssignments) {
            const key = existingAssignment?.documentId
              ? `doc:${existingAssignment.documentId}`
              : existingAssignment?.id != null
                ? `id:${existingAssignment.id}`
                : null;
            if (!key || seen.has(key)) continue;
            seen.add(key);

            if (existingAssignment?.documentId) {
              await docService.update({
                documentId: existingAssignment.documentId,
                data: { due_date: dueValue, active: activeValue },
                status: 'published',
              });
            } else if (existingAssignment?.id != null) {
              await strapi.db.query(COURSE_ASSIGNMENT_UID).update({
                where: { id: existingAssignment.id },
                data: { due_date: dueValue, active: activeValue },
              });
            }
          }
          updated++;
          strapi.log.info('Updated due_date for existing course-assignment (userId=%s, courseId=%s, newDueDate=%s)', userId, courseId, due.toISOString());
        } catch (e) {
          strapi.log.warn('Failed to update due_date for course-assignment (userId=%s):', userId, e?.message || String(e));
        }
        continue;
      }
      
      // Create new entry if user doesn't have this course yet
      try {
        const companyId = companyRaw?.id ?? (Array.isArray(companyRaw?.connect) ? companyRaw.connect[0]?.id : null);
        await docService.create({
          data: {
            assignment_target_type: 'Individual',
            courses: { connect: [{ id: Number(courseId) }] },
            due_date: dueValue,
            active: activeValue,
            individual_user: [userId],
            ...(companyId ? { company: { connect: [{ id: companyId }] } } : {}),
          },
          status: 'published',
        });
        created++;
      } catch (e) {
        strapi.log.warn('createCourseAssignmentEntries failed (userId=%s):', userId, e?.message || String(e));
      }
    }
  } finally {
    _creatingSubEntries = false;
  }
  if (created > 0 || updated > 0) {
    strapi.log.info('user-progress-automation: created %d individual course-assignment entries, updated %d entries with new due_date', created, updated);
  }
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

function registerUserProgressLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [COURSE_ASSIGNMENT_UID],
    async afterCreate(event) {
      try {
        const { result, params = {} } = event;

        if (!result.publishedAt && !result.published_at) return;

        if (result?.assignment_target_type === 'Individual' && _creatingSubEntries) return;

        const assignmentId = result.id ?? result.documentId;
        let payload = null;
        if (params.data) {
          payload = await getAssignedUserIdsFromParams(strapi, params, result);
        }
        if (!payload || !payload.userIds || payload.userIds.length === 0) {
          if (assignmentId != null) {
            await new Promise((r) => setTimeout(r, 200));
            payload = await getAssignedUserIds(strapi, assignmentId);
          }
        }
        let { courseId, courseIds, userIds, due_date, active, targetType } = payload || {};
        if (!courseId || !userIds || userIds.length === 0) {
          if (assignmentId == null) strapi.log.warn('user-progress-automation: afterCreate no id/documentId', result);
          return;
        }
        userIds = [...new Set(userIds)];

        const allCourseIds = (Array.isArray(courseIds) && courseIds.length > 0) ? [...new Set(courseIds)] : [courseId];

        const notifUtil = strapi.utils?.notification;
        const usersWithEmail = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: userIds } },
          select: ['id', 'email'],
        });
        const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };

        for (const rawCourseId of allCourseIds) {
          if (notifUtil) {
            try {
              const meta = { courseId: rawCourseId, assignedBy: null, level: levelMap[targetType] || targetType };

              let courseTitle = 'A new course';
              try {
                const resolvedId = typeof rawCourseId === 'string' && isNaN(Number(rawCourseId)) ? null : Number(rawCourseId);
                const course = await strapi.db.query('api::course.course').findOne({
                  where: resolvedId ? { id: resolvedId } : { documentId: rawCourseId },
                  select: ['title'],
                });
                if (course?.title) courseTitle = course.title;
              } catch { /* keep default */ }

              await notifUtil.sendNotification(
                'course_assigned',
                'Course Assigned',
                `"${courseTitle}" has been assigned to you.`,
                usersWithEmail || [],
                meta,
                []
              );
            } catch (notifErr) {
              strapi.log.error('user-progress-automation: notification failed for courseId=%s', rawCourseId, notifErr?.message || notifErr);
            }
          }

          const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
          if (!numericCourseId) continue;
          await createUserProgressEntries(strapi, numericCourseId, userIds);
          if (targetType !== 'Individual') {
            await createCourseAssignmentEntries(strapi, numericCourseId, userIds, due_date, active, payload?.company);
          }
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

        const numCourseId = await resolveCourseIdForDb(strapi, courseId);
        if (!numCourseId) return;

        const progress = await strapi.db.query(USER_PROGRESS_UID).findOne({
          where: { user: userId, course: numCourseId },
        });
        if (!progress) return;

        // Fetch course for module count + feedback compulsory flag
        const course = await strapi.db.query(COURSE_UID).findOne({
          where: { id: numCourseId },
          populate: { modules: true, feedback: true },
        });
        const feedbackCompulsory = course?.feedback?.[0]?.compulsory === true;
        // Filter modules by the user's selected language
        const effectiveLang = progress.selected_language ?? null;
        const allModules = Array.isArray(course?.modules) ? course.modules : [];
        const langNorm = effectiveLang ? effectiveLang.trim().toLowerCase() : null;
        const langModules = langNorm
          ? allModules.filter((m) => (m.language || '').trim().toLowerCase() === langNorm)
          : allModules;
        const totalModules = (langModules.length > 0 ? langModules : allModules).length;
        const completedModules = Array.isArray(progress.completed_modules) ? progress.completed_modules : [];
        const modulePct = totalModules > 0 ? Math.round((completedModules.length / totalModules) * 80) : 0;
        const quizPct = feedbackCompulsory ? 10 : 20;
        const now = new Date();

        let updateData;
        if (passed) {
          if (feedbackCompulsory) {
            updateData = {
              progress_status: 'In_progress',
              progress_percentage: modulePct + quizPct,
              completed_at: null,
              last_accessed_at: now,
            };
          } else {
            // No feedback required → course complete
            updateData = {
              progress_status: 'Completed',
              progress_percentage: modulePct + quizPct,
              completed_at: now,
              last_accessed_at: now,
              certificate_issued: true,
            };
          }
        } else {
          // Failed: keep module-only percentage
          updateData = {
            progress_status: 'Failed',
            progress_percentage: modulePct,
            completed_at: null,
            last_accessed_at: now,
          };
        }

        await strapi.db.query(USER_PROGRESS_UID).update({
          where: { id: progress.id },
          data: updateData,
        });
      } catch (e) {
        strapi.log.error('user-progress-automation (quiz-submission afterCreate):', e?.message || e);
      }
    },
  });

  strapi.log.info('User-progress automation: course-assignment → Not_started; quiz-submission → In_progress/Failed');
}

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
