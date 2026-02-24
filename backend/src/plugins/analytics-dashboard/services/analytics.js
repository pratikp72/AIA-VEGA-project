'use strict';

/**
 * Analytics Service - Aggregates data for analytics dashboards.
 * Composes shared (employees, departments, unit-locations, activity) with learning and overall methods.
 */
const getShared = (strapi) => require('./analyticsShared')({ strapi });

module.exports = ({ strapi }) => {
  const shared = getShared(strapi);
  return {
    ...shared,
  /**
   * Load full course records by id/documentId so title and course_category (enum) are available for personal view
   */
  async loadCoursesForProgress(progressesOrRecords) {
    if (!progressesOrRecords?.length) return {};
    const byId = {};
    const byDocId = {};
    progressesOrRecords.forEach((p) => {
      const c = p.course;
      const numId = c?.id ?? p.course_id ?? p.courseId ?? p.course;
      const docId = c?.documentId ?? c?.document_id ?? p.course_documentId;
      if (numId != null) {
        if (typeof numId === 'number' || (typeof numId === 'string' && /^\d+$/.test(numId))) byId[numId] = true;
        else if (typeof numId === 'string' && numId.length > 10) byDocId[numId] = true;
      }
      if (docId != null && String(docId).length > 5) byDocId[docId] = true;
    });
    const numericIds = [...new Set(Object.keys(byId).map(Number).filter((n) => !Number.isNaN(n)))];
    const docIds = [...new Set(Object.keys(byDocId))];
    const courseById = {};
    const courseByDocId = {};
    try {
      if (numericIds.length > 0) {
        const byNum = await strapi.db.query('api::course.course').findMany({
          where: { id: { $in: numericIds } },
        });
        (byNum || []).forEach((c) => {
          courseById[c.id] = c;
          if (c.documentId) courseByDocId[c.documentId] = c;
          if (c.document_id) courseByDocId[c.document_id] = c;
        });
      }
      if (docIds.length > 0) {
        try {
          const byDoc = await strapi.db.query('api::course.course').findMany({
            where: { documentId: { $in: docIds } },
          });
          (byDoc || []).forEach((c) => {
            courseById[c.id] = c;
            courseByDocId[c.documentId || c.document_id] = c;
          });
        } catch (docE) {
          const byDocIdCol = await strapi.db.query('api::course.course').findMany({
            where: { document_id: { $in: docIds } },
          });
          (byDocIdCol || []).forEach((c) => {
            courseById[c.id] = c;
            courseByDocId[c.documentId || c.document_id] = c;
          });
        }
      }
    } catch (e) {
      strapi.log.warn('loadCoursesForProgress failed:', e?.message);
    }
    return { courseById, courseByDocId };
  },

  /**
   * Build base filters from query params
   */
  buildFilters(params) {
    const filters = {};

    // Date filter on last_accessed_at (captures all activity, not just completions)
    if (params.dateFrom || params.dateTo) {
      filters.last_accessed_at = {};
      if (params.dateFrom) filters.last_accessed_at.$gte = params.dateFrom;
      if (params.dateTo) filters.last_accessed_at.$lte = params.dateTo;
    }

    // Only apply user filters when meaningful (avoid "All Companies" / "All" filtering out everything)
    const department = params.department && String(params.department).trim() && String(params.department) !== 'all';
    const company = params.company && String(params.company).trim() && String(params.company).toLowerCase() !== 'all companies' && String(params.company).toLowerCase() !== 'all';
    if (department || company) {
      filters.user = {};
      if (department) filters.user.department = { id: params.department };
      if (company) filters.user.company = params.company;
    }

    if (params.courseCategory) {
      filters.course = { course_category: { id: params.courseCategory } };
    }

    return filters;
  },

  /**
   * Get modules for a course (for module filter dropdown). Returns array of { title, module_id, index }.
   */
  async getCourseModules(courseId) {
    if (!courseId) return [];
    try {
      const idStr = String(courseId);
      const isNumeric = /^\d+$/.test(idStr);
      let course = null;
      if (isNumeric) {
        course = await strapi.db.query('api::course.course').findOne({
          where: { id: Number(courseId) },
          populate: { modules: true },
        });
      }
      if (!course) {
        course = await strapi.db.query('api::course.course').findOne({
          where: { documentId: idStr },
          populate: { modules: true },
        });
      }
      if (!course) {
        try {
          course = await strapi.db.query('api::course.course').findOne({
            where: { document_id: idStr },
            populate: { modules: true },
          });
        } catch (_) {}
      }
      const mods = course?.modules ?? course?.attributes?.modules ?? [];
      if (!Array.isArray(mods)) return [];
      return mods.map((m, idx) => ({
        title: m.title ?? m.attributes?.title ?? `Module ${idx + 1}`,
        module_id: m.module_id ?? m.attributes?.module_id ?? String(idx),
        index: m.index ?? idx,
      }));
    } catch (e) {
      strapi.log.warn('getCourseModules failed:', e?.message);
      return [];
    }
  },

  /**
   * LEARNING ANALYTICS - Global (all employees)
   */
  async getLearningGlobal(params = {}) {
    const emptyResponse = () => ({
      kpis: {
        totalCourses: 0,
        totalEnrollments: 0,
        completionRate: 0,
        avgTimeSpentMinutes: 0,
        avgQuizScore: 0,
        completedCourse: 0,
        dropOffRate: 0,
        dropOffCount: 0,
        totalAssignments: 0,
        certificatesIssued: 0,
      },
      statusDistribution: [],
      categoryDistribution: [],
      departmentDistribution: [],
      monthlyCompletions: [],
      learningActivityByWeek: [],
      completionFunnel: [],
    });
    try {
    let progresses = [];
    const wantCompanyEarly = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const wantCompanyNormEarly = wantCompanyEarly ? (String(params.company).trim().toLowerCase() === 'vega' ? 'Vega' : String(params.company).trim().toLowerCase() === 'aia' ? 'AIA' : String(params.company).trim()) : null;
    let companyUserIds = null;
    if (wantCompanyNormEarly) {
      try {
        const companyUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { company: wantCompanyNormEarly, blocked: { $ne: true } },
          select: ['id'],
        });
        companyUserIds = (companyUsers || []).map((u) => u.id).filter((id) => id != null);
      } catch (e) {
        strapi.log.warn('Learning global: company user lookup failed:', e?.message);
      }
    }
    // user-progress has no company field; filter via user relation (user has company)
    // Note: Strapi 5 may not use user_id column - use user relation only
    try {
      let raw = [];
      if (companyUserIds && companyUserIds.length > 0) {
        try {
          raw = await strapi.db.query('api::user-progress.user-progress').findMany({
            where: { user: { id: { $in: companyUserIds } } },
            limit: 5000,
            populate: { course: true, user: true },
          });
        } catch (_) {}
        if (!Array.isArray(raw) || raw.length === 0) {
          raw = await strapi.db.query('api::user-progress.user-progress').findMany({
            limit: 5000,
            populate: { course: true, user: true },
          });
        }
      } else {
        raw = await strapi.db.query('api::user-progress.user-progress').findMany({
          limit: 5000,
          populate: { course: true, user: true },
        });
      }
      if (Array.isArray(raw) && raw.length > 0) {
        const courseIds = [...new Set(raw.map((r) => {
          const c = r.course;
          if (c && typeof c === 'object' && (c.id != null || c.documentId)) return c.id ?? c.documentId;
          return r.course_id ?? r.courseId;
        }).filter(Boolean))];
        const userIdsRaw = [...new Set(raw.map((r) => {
          const u = r.user;
          if (u && typeof u === 'object' && u.id != null) return u.id;
          return r.user_id ?? r.userId;
        }).filter(Boolean))];
        const numericCourseIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
        const numericUserIds = userIdsRaw.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
        const [courses, users] = await Promise.all([
          numericCourseIds.length > 0 ? strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericCourseIds.map(Number) } } }) : [],
          numericUserIds.length > 0 ? strapi.db.query('plugin::users-permissions.user').findMany({ where: { id: { $in: numericUserIds.map(Number) } }, populate: ['department'] }) : [],
        ]);
        const courseById = {};
        (courses || []).forEach((c) => { courseById[c.id] = c; });
        const userById = {};
        (users || []).forEach((u) => { userById[u.id] = u; });
        progresses = raw.map((r) => {
          const uid = r.user_id ?? r.userId ?? r.user?.id;
          const cid = r.course_id ?? r.courseId ?? r.course?.id ?? r.course?.documentId;
          const course = (cid != null && courseById[cid]) ? courseById[cid] : (r.course && typeof r.course === 'object' && (r.course.title != null || r.course.id != null) ? r.course : null);
          const cat = course?.course_category ?? course?.courseCategory;
          const user = (uid != null && userById[uid]) ? userById[uid] : (r.user || null);
          return {
            ...r,
            user,
            user_id: uid,
            course: course ? { ...course, course_category: cat } : null,
          };
        });
      }
    } catch (e) {
      strapi.log.warn('Learning global: db.query failed:', e?.message);
    }
    // Apply filters in memory (date, company, department, course, course category, location, quiz status, feedback given)
    const wantCompany = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const wantDept = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    const wantDateFrom = params.dateFrom;
    const wantDateTo = params.dateTo;
    const wantCourseId = params.courseId && String(params.courseId).trim();
    const wantCategory = params.courseCategory && String(params.courseCategory).trim();
    const wantUnitLocation = params.unitLocation && String(params.unitLocation).trim();
    const wantQuizStatus = params.quizStatus && String(params.quizStatus).trim().toLowerCase();
    const wantFeedbackGiven = params.feedbackGiven && String(params.feedbackGiven).trim().toLowerCase();

    // Resolve unit location id/documentId to name for filtering by user.working_location (if applicable)
    let unitLocationName = wantUnitLocation ? String(params.unitLocation) : null;
    if (wantUnitLocation) {
      try {
        const isNumeric = typeof params.unitLocation === 'number' || /^\d+$/.test(String(params.unitLocation));
        const loc = isNumeric
          ? await strapi.db.query('api::unit-location.unit-location').findOne({ where: { id: Number(params.unitLocation) } })
          : await strapi.db.query('api::unit-location.unit-location').findOne({ where: { documentId: String(params.unitLocation) } });
        if (loc?.name) unitLocationName = loc.name;
      } catch (e) {
        strapi.log.warn('Learning global: unit location resolve failed:', e?.message);
      }
    }

    // Resolve department id/documentId to name for filtering (user.department is string, not relation)
    let departmentNameForFilter = null;
    if (wantDept) {
      try {
        const deptId = params.department;
        const isNumeric = typeof deptId === 'number' || /^\d+$/.test(String(deptId));
        const deptRow = isNumeric
          ? await strapi.db.query('api::department.department').findOne({ where: { id: Number(deptId) }, select: ['name'] })
          : await strapi.db.query('api::department.department').findOne({ where: { documentId: String(deptId) }, select: ['name'] });
        if (deptRow?.name) departmentNameForFilter = deptRow.name;
      } catch (e) {
        strapi.log.warn('Learning global: department resolve failed:', e?.message);
      }
    }

    // Normalize date bounds: start of day for from, end of day for to (so full day is included)
    const wantDateFromNorm = wantDateFrom && /^\d{4}-\d{2}-\d{2}/.test(String(wantDateFrom))
      ? String(wantDateFrom).slice(0, 10) + 'T00:00:00.000Z' : wantDateFrom;
    const wantDateToNorm = wantDateTo && /^\d{4}-\d{2}-\d{2}/.test(String(wantDateTo))
      ? String(wantDateTo).slice(0, 10) + 'T23:59:59.999Z' : wantDateTo;

    // Optional: load quiz and feedback submission sets for (userId, courseId) when filters requested (only when a course is selected)
    let quizPassedByUserCourse = null;
    let quizFailedByUserCourse = null;
    let feedbackByUserCourse = null;
    if (wantCourseId && (wantQuizStatus === 'pass' || wantQuizStatus === 'fail' || wantFeedbackGiven === 'yes' || wantFeedbackGiven === 'no')) {
      const pairs = progresses.map((p) => ({
        userId: p.user?.id ?? p.user_id ?? p.userId,
        courseId: p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId,
      })).filter((x) => x.userId != null && x.courseId != null);
      const uniqueUserIds = [...new Set(pairs.map((x) => x.userId))];
      const uniqueCourseIds = [...new Set(pairs.map((x) => x.courseId).filter(Boolean))];
      const numericUserIds = uniqueUserIds.filter((id) => typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)));
      let numericCourseIds = uniqueCourseIds.filter((id) => typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)));
      // When a course is selected it may be sent as documentId; resolve so quiz/feedback queries find submissions
      if (numericCourseIds.length === 0 && wantCourseId && uniqueCourseIds.length > 0) {
        const courseIdParam = String(params.courseId || '').trim();
        if (courseIdParam.length > 10) {
          try {
            const row = await strapi.db.query('api::course.course').findOne({ where: { documentId: courseIdParam }, select: ['id'] });
            if (row?.id != null) numericCourseIds = [Number(row.id)];
          } catch (_) {}
        } else if (/^\d+$/.test(courseIdParam)) numericCourseIds = [Number(courseIdParam)];
      }
      if (numericUserIds.length > 0 && numericCourseIds.length > 0 && (wantQuizStatus === 'pass' || wantQuizStatus === 'fail')) {
        try {
          // Use raw FK columns for where (Strapi 5 db returns submitted_by_id, course_id when relations not populated)
          const quizSubs = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
            where: {
              submitted_by_id: { $in: numericUserIds },
              course_id: { $in: numericCourseIds },
            },
            limit: 10000,
          });
          quizPassedByUserCourse = new Set();
          quizFailedByUserCourse = new Set();
          (quizSubs || []).forEach((q) => {
            const uid = q.submitted_by?.id ?? q.submitted_by ?? q.submitted_by_id;
            const cid = q.course?.id ?? q.course ?? q.course_id;
            const cidDoc = q.course?.documentId ?? q.course?.document_id;
            if (uid != null && cid != null) {
              const keyNum = `${Number(uid)}-${Number(cid)}`;
              if (q.passed === true) {
                quizPassedByUserCourse.add(keyNum);
              } else {
                quizFailedByUserCourse.add(keyNum);
              }
            }
            if (uid != null && cidDoc != null && String(cidDoc) !== String(cid)) {
              const keyDoc = `${Number(uid)}-${String(cidDoc)}`;
              if (q.passed === true) {
                quizPassedByUserCourse.add(keyDoc);
              } else {
                quizFailedByUserCourse.add(keyDoc);
              }
            }
          });
        } catch (e) {
          strapi.log.warn('Learning global: quiz submission lookup failed:', e?.message);
        }
      }
      if (numericUserIds.length > 0 && numericCourseIds.length > 0 && (wantFeedbackGiven === 'yes' || wantFeedbackGiven === 'no')) {
        try {
          const feedbackSubs = await strapi.db.query('api::feedback-submission.feedback-submission').findMany({
            where: {
              users_permissions_user: { id: { $in: numericUserIds } },
              course: { id: { $in: numericCourseIds } },
            },
            select: ['users_permissions_user', 'course'],
          });
          feedbackByUserCourse = new Set();
          (feedbackSubs || []).forEach((f) => {
            const uid = f.users_permissions_user?.id ?? f.users_permissions_user;
            const cid = f.course?.id ?? f.course;
            const cidDoc = f.course?.documentId ?? f.course?.document_id;
            if (uid != null && (cid != null || cidDoc != null)) {
              if (cid != null) feedbackByUserCourse.add(`${uid}-${cid}`);
              if (cidDoc != null) feedbackByUserCourse.add(`${uid}-${cidDoc}`);
            }
          });
        } catch (e) {
          strapi.log.warn('Learning global: feedback submission lookup failed:', e?.message);
        }
      }
    }

    // For company filter: use companyUserIds when available so we don't rely on populated user.company
    const companyUserIdsSet = companyUserIds && companyUserIds.length > 0
      ? new Set(companyUserIds.map((id) => Number(id)).filter((n) => !Number.isNaN(n)))
      : null;
    if (wantCompany || wantDept || wantDateFrom || wantDateTo || wantCourseId || wantCategory || wantUnitLocation || wantQuizStatus || wantFeedbackGiven) {
      const wantCompanyNorm = wantCompany ? (String(wantCompany).trim().toLowerCase() === 'vega' ? 'Vega' : String(wantCompany).trim().toLowerCase() === 'aia' ? 'AIA' : String(wantCompany).trim()) : null;
      progresses = progresses.filter((p) => {
        if (wantDateFromNorm && p.last_accessed_at && String(p.last_accessed_at) < wantDateFromNorm) return false;
        if (wantDateToNorm && p.last_accessed_at && String(p.last_accessed_at) > wantDateToNorm) return false;
        if (wantCompanyNorm) {
          if (companyUserIdsSet && companyUserIdsSet.size > 0) {
            const uid = p.user?.id ?? p.user_id ?? p.userId;
            if (uid == null || !companyUserIdsSet.has(Number(uid))) return false;
          } else {
            const rawCompany = p.user?.company;
            const userCompanyStr = (typeof rawCompany === 'object' && rawCompany != null) ? (rawCompany.name ?? rawCompany) : (rawCompany ?? '');
            const userCompanyNorm = userCompanyStr ? (String(userCompanyStr).toLowerCase() === 'vega' ? 'Vega' : String(userCompanyStr).toLowerCase() === 'aia' ? 'AIA' : String(userCompanyStr).trim()) : null;
            if (!userCompanyNorm || userCompanyNorm !== wantCompanyNorm) return false;
          }
        }
        if (wantDept && departmentNameForFilter) {
          const userDeptName = (typeof p.user?.department === 'object' && p.user?.department?.name) ? p.user.department.name : (p.user?.department ?? '');
          if (String(userDeptName).trim().toLowerCase() !== String(departmentNameForFilter).trim().toLowerCase()) return false;
        }
        if (wantCourseId) {
          const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId;
          if (String(cid) !== String(params.courseId)) return false;
        }
        if (wantCategory) {
          const cat = p.course?.course_category ?? p.course?.courseCategory ?? '';
          if (String(cat) !== String(params.courseCategory)) return false;
        }
        if (wantUnitLocation && unitLocationName) {
          const loc = p.user?.working_location ?? p.user?.unit_location ?? '';
          if (!String(loc || '').toLowerCase().includes(String(unitLocationName || '').toLowerCase())) return false;
        }
        if (wantCourseId && (wantQuizStatus === 'pass' || wantQuizStatus === 'fail')) {
          const uid = p.user?.id ?? p.user_id ?? p.userId;
          const uidNum = uid != null ? Number(uid) : NaN;
          if (Number.isNaN(uidNum)) return false;
          // Prefer numeric course id to match quiz_submission.course_id; fallback to documentId
          const cidRaw = p.course_id ?? p.courseId ?? p.course?.id ?? p.course?.documentId;
          const cidDoc = p.course?.documentId ?? p.course?.document_id;
          const cidNum = cidRaw != null && (typeof cidRaw === 'number' || /^\d+$/.test(String(cidRaw))) ? Number(cidRaw) : null;
          const keyNum = cidNum != null ? `${uidNum}-${cidNum}` : null;
          const keyDoc = cidDoc != null ? `${uidNum}-${String(cidDoc)}` : null;
          const hasPassed = quizPassedByUserCourse && (keyNum && quizPassedByUserCourse.has(keyNum) || keyDoc && quizPassedByUserCourse.has(keyDoc));
          const hasFailed = quizFailedByUserCourse && (keyNum && quizFailedByUserCourse.has(keyNum) || keyDoc && quizFailedByUserCourse.has(keyDoc));
          if (wantQuizStatus === 'pass') {
            if (!hasPassed) return false;
          } else {
            // fail = has at least one fail AND never passed (so Pass and Fail show different sets)
            if (!hasFailed || hasPassed) return false;
          }
        }
        if (wantCourseId && (wantFeedbackGiven === 'yes' || wantFeedbackGiven === 'no')) {
          const uid = p.user?.id ?? p.user_id ?? p.userId;
          const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId;
          const cidDoc = p.course?.documentId ?? p.course?.document_id;
          const key1 = uid != null && cid != null ? `${uid}-${cid}` : null;
          const key2 = uid != null && cidDoc != null && String(cidDoc) !== String(cid) ? `${uid}-${cidDoc}` : null;
          const hasFeedback = feedbackByUserCourse && (key1 && feedbackByUserCourse.has(key1) || key2 && feedbackByUserCourse.has(key2));
          if (wantFeedbackGiven === 'yes' && !hasFeedback) return false;
          if (wantFeedbackGiven === 'no' && hasFeedback) return false;
        }
        return true;
      });
    }

    // Build userId -> department name map (use numeric id only to avoid 500 if documentId column missing)
    const numericUserIds = [...new Set(progresses.map((p) => p.user?.id ?? p.user_id ?? p.userId).filter((x) => x != null && (typeof x === 'number' || /^\d+$/.test(String(x)))))].map(Number);
    const departmentByUserId = {};
    if (numericUserIds.length > 0) {
      try {
        const users = (await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: numericUserIds } },
          populate: ['department'],
        })) || [];
        users.forEach((u) => {
          const deptName = u.department?.name;
          if (deptName && u.id != null) departmentByUserId[u.id] = deptName;
        });
      } catch (e) {
        strapi.log.warn('Learning global: user/department lookup failed:', e?.message);
      }
    }

    // Aggregate by status
    const statusCounts = { Not_started: 0, In_progress: 0, Completed: 0, Failed: 0 };
    let totalTimeSpent = 0;
    let certificatesIssued = 0;
    const categoryCounts = {};
    const departmentCounts = {};
    const monthlyCompletions = {};
    // Week key = Monday of week (YYYY-MM-DD) for learning activity by week
    const getWeekKey = (dateStr) => {
      const d = new Date(String(dateStr).slice(0, 10));
      if (Number.isNaN(d.getTime())) return null;
      const day = d.getDay();
      const diff = d.getDate() - (day === 0 ? 6 : day - 1);
      const monday = new Date(d.getFullYear(), d.getMonth(), diff);
      return monday.toISOString().slice(0, 10);
    };
    const learningActivityByWeek = {};
    let startedCount = 0;
    const courseIdsSet = new Set();
    const dropOffCutoff = new Date();
    dropOffCutoff.setDate(dropOffCutoff.getDate() - 14);
    const dropOffCutoffStr = dropOffCutoff.toISOString().slice(0, 10);

    progresses.forEach((p) => {
      statusCounts[p.progress_status] = (statusCounts[p.progress_status] || 0) + 1;
      totalTimeSpent += p.time_spent_minutes || 0;
      if (p.certificate_issued) certificatesIssued++;

      const started = p.progress_status !== 'Not_started' || (p.started_at ?? p.startedAt);
      if (started) startedCount++;

      const lastAccess = p.last_accessed_at ?? p.lastAccessedAt;
      if (lastAccess) {
        const weekKey = getWeekKey(lastAccess);
        if (weekKey) learningActivityByWeek[weekKey] = (learningActivityByWeek[weekKey] || 0) + 1;
      }

      const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId;
      if (cid != null) courseIdsSet.add(String(cid));

      const catName = p.course?.course_category?.name ?? p.course?.course_category ?? p.course?.courseCategory ?? 'Other';
      categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;

      const userId = p.user?.id ?? p.user_id ?? p.userId;
      const deptName = (p.user?.department?.name ?? (userId != null ? departmentByUserId[userId] : null)) || 'Unassigned';
      departmentCounts[deptName] = (departmentCounts[deptName] || 0) + 1;

      if (p.completed_at && p.progress_status === 'Completed') {
        const month = p.completed_at.slice(0, 7);
        monthlyCompletions[month] = (monthlyCompletions[month] || 0) + 1;
      }
    });

    const total = progresses.length;
    const completed = statusCounts.Completed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgTimeSpent = total > 0 ? Math.round(totalTimeSpent / total) : 0;

    // Drop-off: started but not completed, and no activity in last 14 days
    let dropOffCount = 0;
    progresses.forEach((p) => {
      const status = p.progress_status;
      const percentage = p.progress_percentage ?? p.progressPercentage ?? 0;
      const lastAccess = p.last_accessed_at ?? p.lastAccessedAt;
      const startedAt = p.started_at ?? p.startedAt;
      const isStarted = status === 'In_progress' || (status === 'Not_started' && startedAt);
      const notCompleted = status !== 'Completed' && status !== 'Failed';
      const inactiveLongEnough = lastAccess && String(lastAccess).slice(0, 10) < dropOffCutoffStr;
      if (isStarted && notCompleted && percentage < 100 && inactiveLongEnough) dropOffCount++;
    });
    const dropOffRate = total > 0 ? Math.round((dropOffCount / total) * 100) : 0;

    // Avg quiz score from filtered set: only quiz submissions for (user, course) in filtered progresses
    let avgQuizScore = 0;
    if (progresses.length > 0) {
      try {
        const numericUserIdsQuiz = [...new Set(progresses.map((p) => p.user?.id ?? p.user_id ?? p.userId).filter((x) => x != null && (typeof x === 'number' || /^\d+$/.test(String(x)))))].map(Number);
        const numericCourseIdsQuiz = [...new Set(progresses.map((p) => p.course?.id ?? p.course_id ?? p.courseId).filter((x) => x != null && (typeof x === 'number' || /^\d+$/.test(String(x)))))].map(Number);
        if (numericUserIdsQuiz.length > 0 && numericCourseIdsQuiz.length > 0) {
          const quizSubs = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
            where: {
              submitted_by: { id: { $in: numericUserIdsQuiz } },
              course: { id: { $in: numericCourseIdsQuiz } },
            },
            select: ['score', 'submitted_by', 'course'],
          });
          const pairsInProgress = new Set(progresses.map((p) => `${p.user?.id ?? p.user_id ?? p.userId}-${p.course?.id ?? p.course_id ?? p.courseId}`));
          const scores = (quizSubs || []).filter((s) => {
            const uid = s.submitted_by?.id ?? s.submitted_by;
            const cid = s.course?.id ?? s.course;
            return uid != null && cid != null && pairsInProgress.has(`${uid}-${cid}`);
          }).map((s) => Number(s.score)).filter((n) => !Number.isNaN(n));
          avgQuizScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        }
      } catch (e) {
        strapi.log.warn('Learning global: avg quiz score from filtered set failed:', e?.message);
      }
    }

    // Learning activity by week: enrollments with activity in that week (by last_accessed_at, week = Monday)
    const learningActivityByWeekArr = Object.entries(learningActivityByWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, enrollments]) => ({ week, enrollments }));

    // Completion funnel: Enrolled -> Started -> Completed -> Certified
    const certified = progresses.filter((p) => p.certificate_issued).length;
    const completionFunnel = [
      { stage: 'Enrolled', value: total },
      { stage: 'Started', value: startedCount },
      { stage: 'Completed', value: completed },
      { stage: 'Certified', value: certified },
    ];

    // Status distribution: Not_started, In_progress, Completed, Failed (for donut)
    const statusDistributionOrder = ['Not_started', 'In_progress', 'Completed', 'Failed'];
    const statusDistribution = statusDistributionOrder.map((name) => ({
      name: name.replace('_', ' '),
      value: statusCounts[name] || 0,
    }));

    // Course view table: one row per course (aggregated across users). Group by title+category so one row per course regardless of id/documentId variance.
    const byCourse = new Map();
    progresses.forEach((p) => {
      const title = String(p.course?.title ?? 'Unknown').trim();
      const category = String(p.course?.course_category ?? p.course?.courseCategory ?? 'Other').trim();
      const key = `${title}::${category}`;
      const cid = p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.courseId;
      if (!byCourse.has(key)) {
        byCourse.set(key, {
          courseId: cid != null ? String(cid) : key,
          courseTitle: title,
          courseCategory: category,
          statusCounts: { Not_started: 0, In_progress: 0, Completed: 0, Failed: 0 },
          percentages: [],
          timeSpentMinutes: [],
          certificateCount: 0,
          total: 0,
        });
      }
      const agg = byCourse.get(key);
      agg.total += 1;
      const st = p.progress_status ?? 'Not_started';
      agg.statusCounts[st] = (agg.statusCounts[st] || 0) + 1;
      agg.percentages.push(p.progress_percentage ?? p.progressPercentage ?? 0);
      agg.timeSpentMinutes.push(p.time_spent_minutes ?? p.timeSpentMinutes ?? 0);
      if (p.certificate_issued ?? p.certificateIssued) agg.certificateCount += 1;
    });

    let courseProgressTable = Array.from(byCourse.values()).map((agg) => {
      const statusParts = [];
      if (agg.statusCounts.Completed > 0) statusParts.push(`Completed: ${agg.statusCounts.Completed}`);
      if (agg.statusCounts.In_progress > 0) statusParts.push(`In progress: ${agg.statusCounts.In_progress}`);
      if (agg.statusCounts.Not_started > 0) statusParts.push(`Not started: ${agg.statusCounts.Not_started}`);
      if (agg.statusCounts.Failed > 0) statusParts.push(`Failed: ${agg.statusCounts.Failed}`);
      const status = statusParts.length > 0 ? statusParts.join(', ') : '—';
      const avgPct = agg.percentages.length > 0 ? Math.round(agg.percentages.reduce((a, b) => a + b, 0) / agg.percentages.length) : 0;
      const avgTime = agg.timeSpentMinutes.length > 0 ? Math.round((agg.timeSpentMinutes.reduce((a, b) => a + b, 0) / agg.timeSpentMinutes.length) * 10) / 10 : 0;
      const certStr = `${agg.certificateCount}/${agg.total}`;
      return {
        courseId: agg.courseId,
        courseTitle: agg.courseTitle,
        courseCategory: agg.courseCategory,
        status,
        percentage: avgPct,
        timeSpentMinutes: avgTime,
        certificateIssued: certStr,
      };
    });

    const result = {
      kpis: {
        totalCourses: courseIdsSet.size,
        totalEnrollments: total,
        totalAssignments: total,
        completionRate,
        avgTimeSpentMinutes: avgTimeSpent,
        avgQuizScore,
        completedCourse: completed,
        dropOffCount,
        dropOffRate,
        certificatesIssued,
      },
      statusDistribution,
      categoryDistribution: Object.entries(categoryCounts).map(([name, value]) => ({ name, value })),
      departmentDistribution: Object.entries(departmentCounts).map(([name, value]) => ({ name, value })),
      monthlyCompletions: Object.entries(monthlyCompletions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({ month, value })),
      learningActivityByWeek: learningActivityByWeekArr,
      completionFunnel,
      courseProgress: courseProgressTable,
    };

    if (wantCourseId) {
      try {
        const moduleVideoRaw = await this.getModuleVideoProgressForCourseGlobal(params.courseId, params.moduleIndex, params.moduleTitle);
        result.moduleVideoProgress = moduleVideoRaw;
        const courseModules = await this.getCourseModules(params.courseId);
        const modIndexes = (params.moduleIndex !== undefined && params.moduleIndex !== null && params.moduleIndex !== '')
          ? [Number(params.moduleIndex)]
          : (courseModules || []).map((m) => m.index ?? m.moduleIndex ?? 0);
        const byCourseMod = new Map();
        moduleVideoRaw.forEach((mv) => {
          const cid = mv.courseId ?? '';
          const midx = mv.moduleIndex ?? mv.module_index;
          if (midx === undefined || midx === null) return;
          const key = `${cid}::${midx}`;
          if (!byCourseMod.has(key)) byCourseMod.set(key, { watched: [], duration: [] });
          const agg = byCourseMod.get(key);
          agg.watched.push(mv.timeWatchedMinutes ?? 0);
          agg.duration.push(mv.videoDurationMinutes ?? 0);
        });
        courseProgressTable = courseProgressTable.map((row) => {
          const cid = row.courseId ?? '';
          const out = { ...row };
          modIndexes.forEach((midx) => {
            const key = `${cid}::${midx}`;
            const agg = byCourseMod.get(key);
            if (!agg || agg.watched.length === 0) {
              out[`mod_${midx}`] = '—';
              return;
            }
            const avgWatched = Math.round((agg.watched.reduce((a, b) => a + b, 0) / agg.watched.length) * 10) / 10;
            const avgDur = agg.duration.filter((d) => d != null && !Number.isNaN(d)).length > 0
              ? Math.round((agg.duration.filter((d) => d != null).reduce((a, b) => a + b, 0) / agg.duration.filter((d) => d != null).length) * 10) / 10
              : null;
            out[`mod_${midx}`] = avgDur != null ? `${avgWatched}/${avgDur}` : String(avgWatched);
          });
          return out;
        });
      } catch (e) {
        strapi.log.warn('Learning global moduleVideoProgress failed:', e?.message);
        result.moduleVideoProgress = [];
      }
    } else {
      result.moduleVideoProgress = [];
    }

    result.courseProgress = courseProgressTable;
    return result;
    } catch (err) {
      strapi.log.error('Learning global error:', err?.message || err);
      return emptyResponse();
    }
  },

  /**
   * Module video progress for global (all users) for a course — same shape as personal moduleVideoProgress for unified table.
   * Returns array of { userId, userName, courseId, moduleIndex, timeWatchedMinutes, videoDurationMinutes }.
   */
  async getModuleVideoProgressForCourseGlobal(courseId, moduleIndex, moduleTitle) {
    const out = [];
    if (!courseId || String(courseId).trim() === '') return out;
    try {
      let numericCourseId = typeof courseId === 'number' ? courseId : null;
      const courseIdStr = String(courseId).trim();
      if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseIdStr);
      if (numericCourseId == null && courseIdStr.length > 10) {
        const c = await strapi.db.query('api::course.course').findOne({ where: { documentId: courseIdStr }, select: ['id'] });
        if (c?.id) numericCourseId = c.id;
        else {
          const c2 = await strapi.db.query('api::course.course').findOne({ where: { document_id: courseIdStr }, select: ['id'] });
          if (c2?.id) numericCourseId = c2.id;
        }
      }
      if (numericCourseId == null) return out;

      const whereVariants = [
        { course: { id: { $eq: numericCourseId } } },
        { course: { id: numericCourseId } },
        { course_id: numericCourseId },
      ];
      if (courseIdStr.length > 10) whereVariants.push({ course: { documentId: courseIdStr } });
      let raw = [];
      for (const where of whereVariants) {
        raw = await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
          where,
          limit: 5000,
          populate: { user: true, course: true },
        });
        if (Array.isArray(raw) && raw.length > 0) break;
      }
      if (!Array.isArray(raw) || raw.length === 0) return out;

      const moduleIndexNum = moduleIndex !== undefined && moduleIndex !== null && moduleIndex !== '' ? Number(moduleIndex) : null;
      const moduleTitleTrim = moduleTitle && String(moduleTitle).trim() ? String(moduleTitle).trim() : null;
      if (moduleIndexNum !== null && !Number.isNaN(moduleIndexNum)) {
        raw = raw.filter((r) => (r.module_index ?? r.moduleIndex) === moduleIndexNum);
      } else if (moduleTitleTrim) {
        raw = raw.filter((r) => {
          const t = (r.module_title ?? r.moduleTitle ?? '').trim().toLowerCase();
          if (t === moduleTitleTrim.toLowerCase()) return true;
          const m = moduleTitleTrim.match(/^Module\s*(\d+)$/i);
          const idx = m ? parseInt(m[1], 10) - 1 : null;
          return idx !== null && (r.module_index ?? r.moduleIndex) === idx;
        });
      }

      const userIds = [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))];
      const userById = {};
      if (userIds.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: userIds.map(Number) } },
        });
        (users || []).forEach((u) => { userById[u.id] = u; });
      }
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        const cid = r.course?.id ?? r.course_id ?? r.course?.documentId;
        const user = (uid != null && userById[uid]) ? userById[uid] : r.user;
        const userName = user?.employee_name || user?.username || user?.email || `User ${uid}`;
        const timeWat = r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0;
        const duration = r.video_duration_seconds ?? r.videoDurationSeconds;
        const mIdx = r.module_index ?? r.moduleIndex;
        out.push({
          userId: uid,
          userName,
          courseId: cid != null ? String(cid) : null,
          moduleIndex: mIdx != null ? Number(mIdx) : null,
          timeWatchedMinutes: Math.round(timeWat / 60),
          videoDurationMinutes: duration != null ? Math.round(duration / 60) : null,
        });
      });
    } catch (e) {
      strapi.log.warn('getModuleVideoProgressForCourseGlobal failed:', e?.message);
    }
    return out;
  },

  /**
   * Module video progress for Course view module detail table.
   * When courseId is null: all modules of all courses. When courseId provided: all modules of that course only.
   */
  async getModuleDetailTable(courseId) {
    const rows = [];
    try {
      const runQuery = async (whereClause) => {
        try {
          return await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where: whereClause,
            limit: 2000,
            populate: { user: true, course: true },
          });
        } catch (e) {
          return [];
        }
      };

      let raw = [];
      if (!courseId || String(courseId).trim() === '') {
        raw = await runQuery({});
      } else {
        let numericCourseId = typeof courseId === 'number' ? courseId : null;
        const courseIdStr = String(courseId || '').trim();
        if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseId);
        if (numericCourseId == null && courseIdStr.length > 10) {
          const c = await strapi.db.query('api::course.course').findOne({
            where: { documentId: courseIdStr },
            select: ['id'],
          });
          if (!c?.id) {
            const c2 = await strapi.db.query('api::course.course').findOne({
              where: { document_id: courseIdStr },
              select: ['id'],
            });
            if (c2?.id) numericCourseId = c2.id;
          } else {
            numericCourseId = c.id;
          }
        }
        if (numericCourseId == null) return [];

        const whereVariants = [
          { course: { id: { $eq: numericCourseId } } },
          { course: { id: numericCourseId } },
          { course_id: numericCourseId },
        ];
        if (courseIdStr.length > 10) {
          // @ts-expect-error - documentId valid for Strapi 5 course relation
          whereVariants.push({ course: { documentId: courseIdStr } });
        }
        for (const where of whereVariants) {
          raw = await runQuery(where);
          if (Array.isArray(raw) && raw.length > 0) break;
        }
        if ((!Array.isArray(raw) || raw.length === 0) && typeof strapi.entityService !== 'undefined') {
          try {
            const list = await strapi.entityService.findMany('api::module-video-progress.module-video-progress', {
              filters: { course: { id: numericCourseId } },
              populate: { user: true, course: true },
              limit: 2000,
            });
            raw = Array.isArray(list) ? list : [];
          } catch (_) {
            raw = [];
          }
        }
        if ((!Array.isArray(raw) || raw.length === 0)) {
          try {
            const all = await runQuery({});
            if (Array.isArray(all) && all.length > 0) {
              raw = all.filter((r) => {
                const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
                return Number(cid) === Number(numericCourseId) || String(cid) === String(numericCourseId) || String(cid) === courseIdStr;
              });
            }
          } catch (_) {
            raw = [];
          }
        }
      }

      if (!Array.isArray(raw)) raw = [];
      const courseById = {};
      const userById = {};
      const courseIds = [...new Set(raw.map((r) => r.course_id ?? r.course?.id ?? r.course?.documentId).filter(Boolean))];
      const userIds = [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))];
      if (courseIds.length > 0) {
        const numericIds = courseIds.filter((x) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number);
        if (numericIds.length > 0) {
          const courses = await strapi.db.query('api::course.course').findMany({
            where: { id: { $in: numericIds } },
          });
          (courses || []).forEach((c) => { courseById[c.id] = c; if (c.documentId) courseById[c.documentId] = c; });
        }
      }
      if (userIds.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: userIds.map(Number) } },
        });
        (users || []).forEach((u) => { userById[u.id] = u; });
      }
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
        const course = (cid != null && courseById[cid]) ? courseById[cid] : r.course;
        const user = (uid != null && userById[uid]) ? userById[uid] : r.user;
        const userName = user?.username ?? user?.employee_name ?? user?.name ?? (user?.email || '—');
        const courseTitle = course?.title ?? '—';
        const modTitle = r.module_title ?? r.moduleTitle ?? (r.module_index != null ? `Module ${r.module_index + 1}` : '—');
        const type = r.video_completion_type ?? r.videoCompletionType ?? 'not_started';
        const timeWat = r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0;
        const duration = r.video_duration_seconds ?? r.videoDurationSeconds;
        rows.push({
          userName,
          courseTitle,
          moduleTitle: modTitle,
          videoCompletionType: type,
          timeWatchedMinutes: Math.round(timeWat / 60),
          videoDurationMinutes: duration != null ? Math.round(duration / 60) : null,
        });
      });
    } catch (e) {
      strapi.log.warn('getModuleDetailTable failed:', e?.message);
    }
    return rows;
  },

  /**
   * Pivoted module detail table when a course is selected.
   * Rows = users, Columns = modules. Each cell shows "Time watched (min) / Duration (min)".
   */
  async getModuleDetailPivotTable(courseId) {
    const result = { moduleColumns: [], rows: [] };
    if (!courseId || String(courseId).trim() === '') return result;
    try {
      const courseModules = await this.getCourseModules(courseId);
      const numModules = courseModules.length;
      if (numModules === 0) return result;

      const runQuery = async (whereClause) => {
        try {
          return await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where: whereClause,
            limit: 2000,
            populate: { user: true, course: true },
          });
        } catch (e) {
          return [];
        }
      };

      let numericCourseId = typeof courseId === 'number' ? courseId : null;
      const courseIdStr = String(courseId || '').trim();
      if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseId);
      if (numericCourseId == null && courseIdStr.length > 10) {
        const c = await strapi.db.query('api::course.course').findOne({
          where: { documentId: courseIdStr },
          select: ['id'],
        });
        if (c?.id) numericCourseId = c.id;
        else {
          const c2 = await strapi.db.query('api::course.course').findOne({
            where: { document_id: courseIdStr },
            select: ['id'],
          });
          if (c2?.id) numericCourseId = c2.id;
        }
      }
      if (numericCourseId == null) return result;

      const whereVariants = [
        { course: { id: { $eq: numericCourseId } } },
        { course: { id: numericCourseId } },
        { course_id: numericCourseId },
      ];
      if (courseIdStr.length > 10) {
        // @ts-expect-error - documentId valid for Strapi 5 course relation
        whereVariants.push({ course: { documentId: courseIdStr } });
      }
      let raw = [];
      for (const where of whereVariants) {
        raw = await runQuery(where);
        if (Array.isArray(raw) && raw.length > 0) break;
      }
      if ((!Array.isArray(raw) || raw.length === 0)) {
        const all = await runQuery({});
        if (Array.isArray(all) && all.length > 0) {
          raw = all.filter((r) => {
            const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
            return Number(cid) === Number(numericCourseId) || String(cid) === String(numericCourseId) || String(cid) === courseIdStr;
          });
        }
      }
      if (!Array.isArray(raw)) raw = [];

      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { id: { $in: [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))].map(Number) } },
      });
      const userById = {};
      (users || []).forEach((u) => { userById[u.id] = u; });

      const userModuleMap = {};
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        if (uid == null) return;
        const mIdx = r.module_index ?? r.moduleIndex ?? 0;
        const timeWat = r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0;
        const duration = r.video_duration_seconds ?? r.videoDurationSeconds;
        const timeMin = Math.round(timeWat / 60);
        const durMin = duration != null ? Math.round(duration / 60) : null;
        const cellVal = durMin != null ? `${timeMin} / ${durMin}` : String(timeMin);
        if (!userModuleMap[uid]) userModuleMap[uid] = {};
        userModuleMap[uid][mIdx] = cellVal;
      });

      result.moduleColumns = courseModules.map((m, idx) => ({
        key: `module_${m.index ?? idx}`,
        label: m.title ?? `Module ${(m.index ?? idx) + 1}`,
      }));

      const userIds = Object.keys(userModuleMap);
      result.rows = userIds.map((uid) => {
        const user = userById[Number(uid)] || raw.find((r) => (r.user_id ?? r.user?.id) === Number(uid))?.user;
        const userName = user?.username ?? user?.employee_name ?? user?.name ?? (user?.email || '—');
        const row = { userName };
        courseModules.forEach((m, idx) => {
          const key = `module_${m.index ?? idx}`;
          row[key] = userModuleMap[uid][m.index ?? idx] ?? '—';
        });
        return row;
      });
      result.rows.sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
    } catch (e) {
      strapi.log.warn('getModuleDetailPivotTable failed:', e?.message);
    }
    return result;
  },

  /**
   * Module video progress for a given course + module (all users). For Course view module detail table.
   */
  async getModuleDetailTableForCourseAndModule(courseId, moduleTitle, moduleIndex) {
    const rows = [];
    try {
      let numericCourseId = typeof courseId === 'number' ? courseId : null;
      const courseIdStr = String(courseId || '');
      if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseId);
      if (numericCourseId == null) {
        const c = await strapi.db.query('api::course.course').findOne({
          where: { documentId: courseIdStr },
          select: ['id'],
        });
        if (!c?.id) {
          const c2 = await strapi.db.query('api::course.course').findOne({
            where: { document_id: courseIdStr },
            select: ['id'],
          });
          if (c2?.id) numericCourseId = c2.id;
        } else {
          numericCourseId = c.id;
        }
      }
      if (numericCourseId == null) return [];

      const moduleTitleTrim = moduleTitle ? String(moduleTitle).trim() : '';
      const moduleIndexNum = moduleIndex != null && moduleIndex !== '' && !Number.isNaN(Number(moduleIndex)) ? Number(moduleIndex) : null;
      if (!moduleTitleTrim && moduleIndexNum === null) return [];

      const runQuery = async (whereClause) => {
        try {
          return await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where: whereClause,
            limit: 2000,
            populate: { user: true, course: true },
          });
        } catch (e) {
          return [];
        }
      };

      // Fetch by course only (no module filter) — try multiple where variants for different Strapi/DB setups
      let raw = [];
      const whereVariants = [
        { course: { id: { $eq: numericCourseId } } },
        { course: { id: numericCourseId } },
        { course_id: numericCourseId },
      ];
      if (typeof courseId === 'string' && courseId.length > 10) {
        // @ts-expect-error - documentId valid for Strapi 5 course relation, not in inferred type
        whereVariants.push({ course: { documentId: courseId } });
      }
      for (const where of whereVariants) {
        raw = await runQuery(where);
        if (Array.isArray(raw) && raw.length > 0) break;
      }
      // Fallback: entityService (different API in some Strapi versions)
      if ((!Array.isArray(raw) || raw.length === 0) && typeof strapi.entityService !== 'undefined') {
        try {
          const list = await strapi.entityService.findMany('api::module-video-progress.module-video-progress', {
            filters: { course: { id: numericCourseId } },
            populate: { user: true, course: true },
            limit: 2000,
          });
          raw = Array.isArray(list) ? list : [];
        } catch (_) {
          raw = [];
        }
      }
      // Last resort: fetch all and filter in memory by course id (handles any DB/Strapi schema difference)
      if ((!Array.isArray(raw) || raw.length === 0)) {
        try {
          const all = await runQuery({});
          if (Array.isArray(all) && all.length > 0) {
            raw = all.filter((r) => {
              const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
              return Number(cid) === Number(numericCourseId) || String(cid) === String(numericCourseId) || String(cid) === courseIdStr;
            });
          }
        } catch (_) {
          raw = [];
        }
      }

      // Filter in memory by module (flexible: title or index)
      if (Array.isArray(raw) && raw.length > 0) {
        const matchModule = (r) => {
          const rTitle = (r.module_title || r.moduleTitle || '').trim().toLowerCase();
          const rIdx = r.module_index ?? r.moduleIndex;
          if (moduleTitleTrim) {
            if (rTitle === moduleTitleTrim.toLowerCase()) return true;
            const match = moduleTitleTrim.match(/^Module\s*(\d+)$/i);
            const idx = match ? parseInt(match[1], 10) - 1 : null;
            if (idx !== null && idx >= 0 && rIdx === idx) return true;
            return false;
          }
          if (moduleIndexNum !== null) return rIdx === moduleIndexNum;
          return true;
        };
        raw = raw.filter(matchModule);
      }
      if (!Array.isArray(raw)) raw = [];
      const courseById = {};
      const userById = {};
      const courseIds = [...new Set(raw.map((r) => r.course_id ?? r.course?.id ?? r.course?.documentId).filter(Boolean))];
      const userIds = [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))];
      if (courseIds.length > 0) {
        const courses = await strapi.db.query('api::course.course').findMany({
          where: { id: { $in: courseIds.filter((x) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number) } },
        });
        (courses || []).forEach((c) => { courseById[c.id] = c; if (c.documentId) courseById[c.documentId] = c; });
      }
      if (userIds.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: userIds.map(Number) } },
        });
        (users || []).forEach((u) => { userById[u.id] = u; });
      }
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
        const course = (cid != null && courseById[cid]) ? courseById[cid] : r.course;
        const user = (uid != null && userById[uid]) ? userById[uid] : r.user;
        const userName = user?.username ?? user?.employee_name ?? user?.name ?? (user?.email || '—');
        const courseTitle = course?.title ?? '—';
        const modTitle = r.module_title ?? r.moduleTitle ?? (r.module_index != null ? `Module ${r.module_index + 1}` : '—');
        const type = r.video_completion_type ?? r.videoCompletionType ?? 'not_started';
        const timeWat = r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0;
        const duration = r.video_duration_seconds ?? r.videoDurationSeconds;
        rows.push({
          userName,
          courseTitle,
          moduleTitle: modTitle,
          videoCompletionType: type,
          timeWatchedMinutes: Math.round(timeWat / 60),
          videoDurationMinutes: duration != null ? Math.round(duration / 60) : null,
        });
      });
    } catch (e) {
      strapi.log.warn('getModuleDetailTableForCourseAndModule failed:', e?.message);
    }
    return rows;
  },

  /**
   * LEARNING ANALYTICS - Personal (single employee)
   */
  async getLearningPersonal(userId, params = {}) {
    if (!userId) return null;

    const emptyResponse = () => ({
      kpis: { totalCourses: 0, completionRate: 0, avgTimeSpentMinutes: 0, certificatesEarned: 0 },
      statusDistribution: [],
      categoryDistribution: [],
      departmentDistribution: [],
      courseProgress: [],
      monthlyCompletions: [],
    });
    try {
    const isDocumentId = typeof userId === 'string' && userId.length > 10 && !/^\d+$/.test(userId);
    let numericUserId = typeof userId === 'number' ? userId : (typeof userId === 'string' && /^\d+$/.test(userId) ? parseInt(userId, 10) : null);
    if (isDocumentId && !numericUserId) {
      try {
        let u = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { documentId: userId },
          select: ['id'],
        });
        if (!u?.id) {
          u = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { document_id: userId },
            select: ['id'],
          });
        }
        if (u?.id != null) numericUserId = u.id;
      } catch (e) {
        strapi.log.warn('Learning personal: resolve documentId failed:', e?.message);
      }
    }

    let progresses = [];
    // 1) Prefer Document Service with user filter (so we only fetch this user's progress)
    if (numericUserId != null) {
      try {
        const filtered = await strapi.documents('api::user-progress.user-progress').findMany({
          status: 'published',
          filters: { user: { id: numericUserId } },
          populate: ['user', 'course', 'course.course_category'],
          limit: 500,
          start: 0,
        });
        if (Array.isArray(filtered) && filtered.length > 0) progresses = filtered;
      } catch (e2) {
        strapi.log.warn('Learning personal: document findMany (with user filter) failed:', e2?.message || String(e2));
      }
    }
    // 1b) Fallback: fetch all published and filter in memory (if filtered call failed or returned 0)
    if (progresses.length === 0) {
      try {
        let allProgress = await strapi.documents('api::user-progress.user-progress').findMany({
          status: 'published',
          populate: ['user', 'course', 'course.course_category'],
          limit: 5000,
          start: 0,
        });
        if (!Array.isArray(allProgress)) allProgress = [];
        progresses = allProgress.filter((p) => {
          const u = p.user;
          if (!u) return false;
          if (numericUserId != null && (u.id === numericUserId || u.id === Number(numericUserId))) return true;
          if (typeof userId === 'string' && (u.documentId === userId || u.document_id === userId)) return true;
          return false;
        });
      } catch (e2) {
        strapi.log.warn('Learning personal: document findMany (all) failed:', e2?.message || String(e2));
      }
    }
    // 2) Fallback to db.query (try user_id then user) with course populated
    if (progresses.length === 0 && numericUserId != null) {
      for (const userKey of ['user_id', 'user']) {
        try {
          const where = { [userKey]: userKey === 'user' ? { id: numericUserId } : numericUserId };
          if (params.dateFrom || params.dateTo) {
            const dateFilter = {};
            if (params.dateFrom) dateFilter.$gte = params.dateFrom;
            if (params.dateTo) dateFilter.$lte = params.dateTo;
            // @ts-ignore - Dynamic query builder
            where['last_accessed_at'] = dateFilter;
          }
          const raw = await strapi.db.query('api::user-progress.user-progress').findMany({
            where,
            limit: 500,
            populate: { course: true },
          });
          if (Array.isArray(raw) && raw.length > 0) {
            const courseIds = [...new Set(raw.map((r) => {
              const c = r.course;
              if (c && typeof c === 'object' && (c.id != null || c.documentId)) return c.id ?? c.documentId;
              return r.course_id ?? r.courseId ?? r.course;
            }).filter(Boolean))];
            const numericCourseIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
            const docCourseIds = courseIds.filter((x) => typeof x === 'string' && x.length > 10);
            const courses = [];
            if (numericCourseIds.length > 0) {
              const byId = await strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericCourseIds.map(Number) } } });
              courses.push(...(byId || []));
            }
            if (docCourseIds.length > 0) {
              try {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { documentId: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              } catch (_) {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { document_id: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              }
            }
            const courseById = {};
            const courseByDocId = {};
            courses.forEach((c) => {
              courseById[c.id] = c;
              if (c.documentId) courseByDocId[c.documentId] = c;
              if (c.document_id) courseByDocId[c.document_id] = c;
            });
            progresses = raw.map((r) => {
              const c = r.course;
              const cid = (c && typeof c === 'object') ? (c.id ?? c.documentId ?? c.document_id) : (r.course_id ?? r.courseId ?? r.course);
              const course = (cid != null && courseById[cid]) || (cid != null && courseByDocId[cid])
                ? (courseById[cid] || courseByDocId[cid])
                : (c && typeof c === 'object' && (c.title != null || c.id != null) ? c : null);
              const cat = course?.course_category ?? course?.courseCategory;
              return {
                ...r,
                course: course ? { ...course, course_category: cat } : null,
              };
            });
            break;
          }
        } catch (e) {
          strapi.log.warn('Learning personal: db.query failed (userKey=' + userKey + '):', e?.message || String(e));
        }
      }
    }
    // Apply date filter in memory
    if (params.dateFrom || params.dateTo) {
      progresses = progresses.filter((p) => {
        const at = p.last_accessed_at;
        if (!at) return true;
        if (params.dateFrom && at < params.dateFrom) return false;
        if (params.dateTo && at > params.dateTo) return false;
        return true;
      });
    }

    // Ensure course title and category are loaded (document service may return relation as stub)
    const { courseById, courseByDocId } = await this.loadCoursesForProgress(progresses);
    progresses = progresses.map((p) => {
      const cid = p.course?.id ?? p.course_id ?? p.courseId ?? (typeof p.course === 'number' || (typeof p.course === 'string' && /^\d+$/.test(p.course)) ? p.course : null);
      const cdocId = p.course?.documentId ?? p.course?.document_id ?? (typeof p.course === 'string' && p.course.length > 10 ? p.course : null);
      const fullCourse = (cid != null && courseById[cid]) || (cdocId != null && courseByDocId[cdocId]) || (p.course && typeof p.course === 'object' && (p.course.title != null || p.course.id != null) ? p.course : null);
      return { ...p, course: fullCourse || p.course };
    });

    // Deduplicate by course (full list) for KPIs that must reflect all courses (e.g. last course viewed)
    const courseKey = (p) => (p.course?.documentId ?? p.course?.document_id ?? p.course?.id ?? p.course_id ?? p.courseId ?? p.course ?? '').toString();
    const statusOrder = { Completed: 0, In_progress: 1, Failed: 2, Not_started: 3 };
    const byCourseAll = new Map();
    progresses.forEach((p) => {
      const key = courseKey(p);
      if (!key) return;
      const existing = byCourseAll.get(key);
      const pStatus = statusOrder[p.progress_status] ?? 4;
      const existingStatus = existing ? (statusOrder[existing.progress_status] ?? 4) : 4;
      const pAt = p.last_accessed_at ? new Date(p.last_accessed_at).getTime() : 0;
      const existingAt = existing && existing.last_accessed_at ? new Date(existing.last_accessed_at).getTime() : 0;
      if (!existing || pStatus < existingStatus || (pStatus === existingStatus && pAt >= existingAt)) {
        byCourseAll.set(key, p);
      }
    });
    const progressesDedupAll = Array.from(byCourseAll.values());

    // Filter by course when params.courseId is set (Personal view course filter)
    const wantCourseId = params.courseId && String(params.courseId).trim();
    if (wantCourseId) {
      const courseIdStr = String(params.courseId).trim();
      let resolvedNumericId = null;
      if (courseIdStr.length > 10 && !/^\d+$/.test(courseIdStr)) {
        try {
          const row = await strapi.db.query('api::course.course').findOne({
            where: { documentId: courseIdStr },
            select: ['id'],
          });
          if (!row?.id) {
            const row2 = await strapi.db.query('api::course.course').findOne({
              where: { document_id: courseIdStr },
              select: ['id'],
            });
            if (row2?.id) resolvedNumericId = row2.id;
          } else {
            resolvedNumericId = row.id;
          }
        } catch (_) {}
      } else if (/^\d+$/.test(courseIdStr)) {
        resolvedNumericId = Number(courseIdStr);
      }
      progresses = progresses.filter((p) => {
        const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId ?? p.course?.document_id ?? p.course;
        if (cid == null) return false;
        if (String(cid) === courseIdStr) return true;
        if (resolvedNumericId != null && (Number(cid) === resolvedNumericId || cid === resolvedNumericId)) return true;
        if (Number(cid) === Number(courseIdStr)) return true;
        return false;
      });
    }

    // Deduplicate filtered progress: one row per course in "My Course" table
    const byCourse = new Map();
    progresses.forEach((p) => {
      const key = courseKey(p);
      if (!key) return;
      const existing = byCourse.get(key);
      const pStatus = statusOrder[p.progress_status] ?? 4;
      const existingStatus = existing ? (statusOrder[existing.progress_status] ?? 4) : 4;
      const pAt = p.last_accessed_at ? new Date(p.last_accessed_at).getTime() : 0;
      const existingAt = existing && existing.last_accessed_at ? new Date(existing.last_accessed_at).getTime() : 0;
      if (!existing || pStatus < existingStatus || (pStatus === existingStatus && pAt >= existingAt)) {
        byCourse.set(key, p);
      }
    });
    const progressesDedup = Array.from(byCourse.values());

    const statusCounts = { Not_started: 0, In_progress: 0, Completed: 0, Failed: 0 };
    let totalTimeSpent = 0;
    const courseProgress = [];
    const monthlyCompletions = {};
    const categoryCounts = {};
    const departmentCounts = {};

    // --- Quiz/Feedback lookup for all courses for this user ---
    // Build sets for quick lookup
    let quizPassedByCourse = new Set();
    let feedbackGivenByCourse = new Set();
    let feedbackPendingByCourse = new Set();
    try {
      const userIdNum = progressesDedup[0]?.user?.id ?? progressesDedup[0]?.user_id ?? progressesDedup[0]?.userId ?? null;
      const courseIds = progressesDedup.map(p => p.course?.id ?? p.course_id ?? p.courseId).filter(Boolean);
      if (userIdNum && courseIds.length > 0) {
        // Quiz submissions
        const quizSubs = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: {
            submitted_by: { id: userIdNum },
            course: { id: { $in: courseIds } },
          },
          select: ['course', 'passed'],
        });
        (quizSubs || []).forEach(q => {
          const cid = q.course?.id ?? q.course;
          if (cid != null && q.passed === true) quizPassedByCourse.add(String(cid));
        });
        // Feedback submissions
        const feedbackSubs = await strapi.db.query('api::feedback-submission.feedback-submission').findMany({
          where: {
            users_permissions_user: { id: userIdNum },
            course: { id: { $in: courseIds } },
          },
          select: ['course'],
        });
        (feedbackSubs || []).forEach(f => {
          const cid = f.course?.id ?? f.course;
          if (cid != null) feedbackGivenByCourse.add(String(cid));
        });
        // Mark feedback pending for courses that are completed but have no feedback
        progressesDedup.forEach(p => {
          const cid = p.course?.id ?? p.course_id ?? p.courseId;
          if (cid && p.progress_status === 'Completed' && !feedbackGivenByCourse.has(String(cid))) {
            feedbackPendingByCourse.add(String(cid));
          }
        });
      }
    } catch (e) {
      strapi.log.warn('Learning personal: quiz/feedback lookup failed:', e?.message);
    }

    progressesDedup.forEach((p) => {
      statusCounts[p.progress_status] = (statusCounts[p.progress_status] || 0) + 1;
      totalTimeSpent += p.time_spent_minutes || 0;

      // course_category on course is an enum (Mandatory/Orientation/Other), not a relation
      const catNamePersonal = p.course?.course_category ?? p.course?.courseCategory ?? 'Other';
      categoryCounts[catNamePersonal] = (categoryCounts[catNamePersonal] || 0) + 1;

      const courseId = p.course?.documentId ?? p.course?.document_id ?? p.course?.id ?? p.course_id ?? p.courseId;
      courseProgress.push({
        courseId: courseId != null ? String(courseId) : null,
        courseTitle: p.course?.title ?? 'Unknown',
        courseCategory: catNamePersonal,
        status: p.progress_status,
        percentage: p.progress_percentage ?? 0,
        timeSpentMinutes: p.time_spent_minutes ?? 0,
        completedAt: p.completed_at,
        certificateIssued: p.certificate_issued ?? false,
        quizPassed: courseId && quizPassedByCourse.has(String(courseId)),
        feedbackGiven: courseId && feedbackGivenByCourse.has(String(courseId)),
        feedbackPending: courseId && feedbackPendingByCourse.has(String(courseId)),
      });

      if (p.completed_at && p.progress_status === 'Completed') {
        const month = p.completed_at.slice(0, 7);
        monthlyCompletions[month] = (monthlyCompletions[month] || 0) + 1;
      }
    });

    if (progressesDedup.length > 0) {
      const userWhere = isDocumentId ? { documentId: userId } : { id: userId };
      let u = null;
      try {
        u = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: userWhere,
          populate: ['department'],
        });
      } catch (e) {
        strapi.log.warn('Learning personal: user lookup failed:', e?.message);
      }
      const deptName = u?.department?.name || 'Unassigned';
      departmentCounts[deptName] = progressesDedup.length;
    }

    const total = progressesDedup.length;
    const completed = statusCounts.Completed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgTimeSpent = total > 0 ? Math.round(totalTimeSpent / total) : 0;

    const dropOffCutoffPersonal = new Date();
    dropOffCutoffPersonal.setDate(dropOffCutoffPersonal.getDate() - 14);
    const dropOffCutoffStrPersonal = dropOffCutoffPersonal.toISOString().slice(0, 10);
    let dropOffCountPersonal = 0;
    progressesDedup.forEach((p) => {
      const status = p.progress_status;
      const percentage = p.progress_percentage ?? p.progressPercentage ?? 0;
      const lastAccess = p.last_accessed_at ?? p.lastAccessedAt;
      const startedAt = p.started_at ?? p.startedAt;
      const isStarted = status === 'In_progress' || (status === 'Not_started' && startedAt);
      const notCompleted = status !== 'Completed' && status !== 'Failed';
      const inactiveLongEnough = lastAccess && String(lastAccess).slice(0, 10) < dropOffCutoffStrPersonal;
      if (isStarted && notCompleted && percentage < 100 && inactiveLongEnough) dropOffCountPersonal++;
    });
    const dropOffRatePersonal = total > 0 ? Math.round((dropOffCountPersonal / total) * 100) : 0;
    const courseIdsPersonal = new Set(progressesDedup.map((p) => p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId).filter(Boolean));

    // Calculate additional KPIs (last viewed/completed use full list so they are not affected by course filter)
    const inProgressCourses = progressesDedup.filter((p) => p.progress_status === 'In_progress');
    const lastCourseViewed = progressesDedupAll.reduce((latest, p) => {
      if (!p.last_accessed_at) return latest;
      if (!latest || new Date(p.last_accessed_at) > new Date(latest.last_accessed_at)) return p;
      return latest;
    }, null);
    const lastCourseCompleted = progressesDedupAll.filter((p) => p.progress_status === 'Completed').reduce((latest, p) => {
      if (!p.completed_at) return latest;
      if (!latest || new Date(p.completed_at) > new Date(latest.completed_at)) return p;
      return latest;
    }, null);

    return {
      kpis: {
        totalCourses: courseIdsPersonal.size, // 1. total course assigned
        completedCourses: statusCounts.Completed, // 2. completed course
        avgTimeSpentPerCourse: total > 0 ? Math.round(totalTimeSpent / total) : 0, // 3. avg time spent per course
        certificatesEarned: progressesDedup.filter((p) => p.certificate_issued).length, // 4. certificates earned
        quizPassRate: null, // 5. quiz pass rate (to be filled by controller)
        avgQuizScore: null, // 6. avg quiz score (to be filled by controller)
        coursesInProgress: inProgressCourses.length, // 7. courses in progress
        lastCourseViewed: lastCourseViewed ? {
          courseTitle: lastCourseViewed.course?.title ?? 'Unknown',
          lastAccessedAt: lastCourseViewed.last_accessed_at
        } : null, // 8. last course view with time
        lastCourseCompleted: lastCourseCompleted ? {
          courseTitle: lastCourseCompleted.course?.title ?? 'Unknown',
          completedAt: lastCourseCompleted.completed_at
        } : null, // 9. last course completed with time
        // Existing KPIs for compatibility
        totalEnrollments: total,
        completionRate,
        avgTimeSpentMinutes: avgTimeSpent,
        completedCourse: completed,
        dropOffCount: dropOffCountPersonal,
        dropOffRate: dropOffRatePersonal,
      },
      statusDistribution: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
      categoryDistribution: Object.entries(categoryCounts).map(([name, value]) => ({ name, value })),
      departmentDistribution: Object.entries(departmentCounts).map(([name, value]) => ({ name, value })),
      courseProgress,
      monthlyCompletions: Object.entries(monthlyCompletions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({ month, value })),
    };
    } catch (err) {
      strapi.log.error('Learning personal error:', err?.message || err);
      return emptyResponse();
    }
  },

  /**
   * LEARNING ANALYTICS - Personal module video progress (watched fully vs skipped to end)
   */
  async getLearningPersonalModuleVideoProgress(userId, params = {}) {
    if (!userId) {
      return {
        moduleVideoKpis: { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 },
        moduleVideoProgress: [],
      };
    }

    let numericUserId = typeof userId === 'number' ? userId : (typeof userId === 'string' && /^\d+$/.test(userId) ? parseInt(userId, 10) : null);
    const isDocumentId = typeof userId === 'string' && userId.length > 10 && !/^\d+$/.test(userId);
    if (isDocumentId && !numericUserId) {
      try {
        const u = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { documentId: userId },
          select: ['id'],
        });
        if (u?.id != null) numericUserId = u.id;
      } catch (e) {
        strapi.log.warn('Module video: resolve documentId failed:', e?.message);
      }
    }

    let records = [];
    const wantCourseId = params.courseId && String(params.courseId).trim();
    let resolvedCourseNumericId = null;
    if (wantCourseId) {
      const courseIdStr = String(params.courseId).trim();
      if (courseIdStr.length > 10 && !/^\d+$/.test(courseIdStr)) {
        try {
          const row = await strapi.db.query('api::course.course').findOne({ where: { documentId: courseIdStr }, select: ['id'] });
          if (row?.id) resolvedCourseNumericId = row.id;
          else {
            const row2 = await strapi.db.query('api::course.course').findOne({ where: { document_id: courseIdStr }, select: ['id'] });
            if (row2?.id) resolvedCourseNumericId = row2.id;
          }
        } catch (_) {}
      } else if (/^\d+$/.test(courseIdStr)) {
        resolvedCourseNumericId = Number(courseIdStr);
      }
    }

    // 0) When course is selected: use same db.query pattern as Course view (user_id + course_id) so we get data
    const courseIdStrForQuery = wantCourseId ? String(params.courseId).trim() : '';
    if (numericUserId != null && (resolvedCourseNumericId != null || courseIdStrForQuery.length > 10)) {
      const whereVariants = [
        resolvedCourseNumericId != null && { user_id: numericUserId, course_id: resolvedCourseNumericId },
        resolvedCourseNumericId != null && { user: { id: numericUserId }, course: { id: resolvedCourseNumericId } },
        resolvedCourseNumericId != null && { user: { id: numericUserId }, course_id: resolvedCourseNumericId },
        courseIdStrForQuery.length > 10 && { user_id: numericUserId, course: { documentId: courseIdStrForQuery } },
      ].filter(Boolean);
      for (const where of whereVariants) {
        try {
          const raw = await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where,
            limit: 1000,
            populate: { course: true },
          });
          if (Array.isArray(raw) && raw.length > 0) {
            const courseById = {};
            const courseByDocId = {};
            const courseIds = [...new Set(raw.map((r) => r.course?.id ?? r.course_id ?? r.courseId ?? r.course?.documentId).filter(Boolean))];
            const numericIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x))).map(Number);
            const docIds = courseIds.filter((x) => typeof x === 'string' && x.length > 10);
            if (numericIds.length > 0) {
              const byId = await strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericIds } } }) || [];
              byId.forEach((c) => { courseById[c.id] = c; if (c.documentId) courseByDocId[c.documentId] = c; });
            }
            if (docIds.length > 0) {
              try {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { documentId: { $in: docIds } } }) || [];
                byDoc.forEach((c) => { courseById[c.id] = c; if (c.documentId) courseByDocId[c.documentId] = c; });
              } catch (_) {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { document_id: { $in: docIds } } }) || [];
                byDoc.forEach((c) => { courseById[c.id] = c; if (c.documentId) courseByDocId[c.documentId] = c; });
              }
            }
            records = raw.map((r) => {
              const c = r.course;
              const cid = (c && typeof c === 'object') ? (c.id ?? c.documentId) : (r.course_id ?? r.courseId);
              const course = (cid != null && courseById[cid]) || (cid != null && courseByDocId[cid]) ? (courseById[cid] || courseByDocId[cid]) : c;
              return {
                ...r,
                course,
                video_completion_type: r.video_completion_type ?? r.videoCompletionType,
                time_watched_seconds: r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0,
                video_duration_seconds: r.video_duration_seconds ?? r.videoDurationSeconds,
                module_title: r.module_title ?? r.moduleTitle,
                module_index: r.module_index ?? r.moduleIndex,
              };
            });
            break;
          }
        } catch (e) {
          strapi.log.warn('Module video progress (user+course) failed:', e?.message);
        }
      }
    }

    // 1) Document Service with user filter (try published first, then draft so draft entries show)
    if (records.length === 0 && numericUserId != null) {
      for (const status of ['published', 'draft']) {
        try {
          const filters = { user: { id: numericUserId } };
          if (params.dateFrom || params.dateTo) {
            filters.last_updated = {};
            if (params.dateFrom) filters.last_updated.$gte = params.dateFrom;
            if (params.dateTo) filters.last_updated.$lte = params.dateTo;
          }
          const docRecords = await strapi.documents('api::module-video-progress.module-video-progress').findMany({
            status,
            filters,
            populate: ['course'],
            limit: 1000,
            start: 0,
          });
          if (Array.isArray(docRecords) && docRecords.length > 0) {
            records = docRecords;
            break;
          }
        } catch (e2) {
          strapi.log.warn('Module video progress document findMany failed:', e2?.message || String(e2));
        }
      }
    }
    // 2) Fallback: db.query (try user_id then user relation with $eq) with course populated
    if (records.length === 0 && numericUserId != null) {
      const userWhereVariants = [
        { user_id: numericUserId },
        { user: { id: numericUserId } },
        { user: { id: { $eq: numericUserId } } },
      ];
      for (const whereVariant of userWhereVariants) {
        try {
          const dateFilter = {};
          if (params.dateFrom) dateFilter.$gte = params.dateFrom;
          if (params.dateTo) dateFilter.$lte = params.dateTo;
          const where = (params.dateFrom || params.dateTo) ? { ...whereVariant, last_updated: dateFilter } : whereVariant;
          const raw = await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where,
            limit: 1000,
            populate: { course: true },
          });
          if (Array.isArray(raw) && raw.length > 0) {
            const courseIds = [...new Set(raw.map((r) => {
              const c = r.course;
              if (c && typeof c === 'object' && (c.id != null || c.documentId)) return c.id ?? c.documentId;
              return r.course_id ?? r.courseId ?? r.course;
            }).filter(Boolean))];
            const numericCourseIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
            const docCourseIds = courseIds.filter((x) => typeof x === 'string' && x.length > 10);
            const courses = [];
            if (numericCourseIds.length > 0) {
              const byId = await strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericCourseIds.map(Number) } } });
              courses.push(...(byId || []));
            }
            if (docCourseIds.length > 0) {
              try {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { documentId: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              } catch (_) {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { document_id: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              }
            }
            const courseById = {};
            const courseByDocId = {};
            courses.forEach((c) => {
              courseById[c.id] = c;
              if (c.documentId) courseByDocId[c.documentId] = c;
              if (c.document_id) courseByDocId[c.document_id] = c;
            });
            records = raw.map((r) => {
              const c = r.course;
              const cid = (c && typeof c === 'object') ? (c.id ?? c.documentId ?? c.document_id) : (r.course_id ?? r.courseId ?? r.course);
              const course = (cid != null && courseById[cid]) || (cid != null && courseByDocId[cid])
                ? (courseById[cid] || courseByDocId[cid])
                : (c && typeof c === 'object' && (c.title != null || c.id != null) ? c : null);
              return {
                ...r,
                course,
                video_completion_type: r.video_completion_type ?? r.videoCompletionType,
                time_watched_seconds: r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0,
                video_duration_seconds: r.video_duration_seconds ?? r.videoDurationSeconds,
                module_title: r.module_title ?? r.moduleTitle,
                module_index: r.module_index ?? r.moduleIndex,
              };
            });
            break;
          }
        } catch (e) {
          strapi.log.warn('Module video progress db.query failed:', e?.message || String(e));
        }
      }
    }

    // Ensure course title is loaded for module video progress (avoid "Unknown" in personal view)
    const { courseById, courseByDocId } = await this.loadCoursesForProgress(records);
    const recordsWithCourse = records.map((r) => {
      const cid = r.course?.id ?? r.course_id ?? r.courseId;
      const cdocId = r.course?.documentId ?? r.course?.document_id;
      const fullCourse = (cid != null && courseById[cid]) || (cdocId != null && courseByDocId[cdocId]) || r.course;
      return { ...r, course: fullCourse || r.course };
    });

    // Filter by course and/or module when params specify (Personal view course/module filter)
    let filteredRecords = recordsWithCourse || [];
    const wantModuleTitle = params.moduleTitle && String(params.moduleTitle).trim();
    const wantModuleIndex = params.moduleIndex !== undefined && params.moduleIndex !== null && params.moduleIndex !== '';
    const moduleIndexNum = wantModuleIndex ? Number(params.moduleIndex) : null;
    const hasValidModuleIndex = wantModuleIndex && !Number.isNaN(moduleIndexNum);

    if (wantCourseId || wantModuleTitle || hasValidModuleIndex) {
      filteredRecords = filteredRecords.filter((r) => {
        if (wantCourseId) {
          const cid = r.course?.id ?? r.course_id ?? r.courseId ?? r.course?.documentId ?? r.course?.document_id;
          if (cid == null) return false;
          const courseIdStr = String(params.courseId).trim();
          const courseMatches = String(cid) === courseIdStr ||
            (resolvedCourseNumericId != null && (Number(cid) === resolvedCourseNumericId || cid === resolvedCourseNumericId)) ||
            Number(cid) === Number(courseIdStr);
          if (!courseMatches) return false;
        }
        if (wantModuleTitle || hasValidModuleIndex) {
          const mIdx = r.module_index ?? r.moduleIndex;
          if (hasValidModuleIndex) {
            if (mIdx !== moduleIndexNum) return false;
          } else if (wantModuleTitle) {
            const mTitle = (r.module_title ?? r.moduleTitle ?? '').trim().toLowerCase();
            const paramTitle = wantModuleTitle.toLowerCase();
            if (mTitle === paramTitle) return true;
            const match = paramTitle.match(/module\s*(\d+)/i) || paramTitle.match(/^(\d+)$/);
            const oneBased = match ? parseInt(match[1], 10) : null;
            const idx = oneBased != null ? oneBased - 1 : null;
            if (idx !== null && mIdx === idx) return true;
            return false;
          }
        }
        return true;
      });
    }

    const kpis = { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 };
    const typeToKpi = { full_watch: 'watchedFully', skipped_to_end: 'skippedToEnd', in_progress: 'inProgress', not_started: 'notStarted' };
    // When filtering by course, use params.courseId so frontend row and module video progress match (same id format)
    const canonicalCourseId = wantCourseId ? String(params.courseId).trim() : null;
    const progress = filteredRecords.map((r) => {
      const type = r.video_completion_type ?? r.videoCompletionType ?? 'not_started';
      const kpiKey = typeToKpi[type];
      if (kpiKey) kpis[kpiKey] += 1;
      const courseIdRaw = r.course?.documentId ?? r.course?.document_id ?? r.course?.id ?? r.course_id ?? r.courseId;
      const courseId = canonicalCourseId != null ? canonicalCourseId : (courseIdRaw != null ? String(courseIdRaw) : null);
      const courseTitle = r.course?.title ?? 'Unknown';
      const moduleTitle = r.module_title ?? r.moduleTitle ?? (r.module_index != null ? `Module ${(r.module_index ?? r.moduleIndex) + 1}` : 'Unknown');
      const timeWat = r.time_watched_seconds != null ? r.time_watched_seconds : (r.timeWatchedSeconds ?? 0);
      const duration = r.video_duration_seconds != null ? r.video_duration_seconds : (r.videoDurationSeconds ?? 0);
      const moduleIdx = r.module_index ?? r.moduleIndex ?? null;
      return {
        courseId,
        courseTitle,
        moduleTitle,
        moduleIndex: moduleIdx != null ? Number(moduleIdx) : null,
        videoCompletionType: type,
        timeWatchedMinutes: Math.round(timeWat / 60),
        videoDurationMinutes: duration > 0 ? Math.round(duration / 60) : null,
      };
    });

    progress.sort((a, b) => {
      const c = (a.courseTitle || '').localeCompare(b.courseTitle || '');
      return c !== 0 ? c : (a.moduleTitle || '').localeCompare(b.moduleTitle || '');
    });

    return {
      moduleVideoKpis: kpis,
      moduleVideoProgress: progress,
    };
  },

  /**
   * QUIZ ANALYTICS - Global
   */
  async getQuizGlobal(params = {}) {
    let submissions = [];
    // 1) Prefer Document Service (published) so quiz stats show seeded data
    try {
      submissions = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        status: 'published',
        populate: ['quiz', 'submitted_by'],
        limit: 5000,
        start: 0,
      });
      if (!Array.isArray(submissions)) submissions = [];
    } catch (e2) {
      strapi.log.warn('Quiz document findMany failed:', e2?.message || e2);
    }
    // 2) Fallback to db.query if Document Service returned nothing
    if (submissions.length === 0) {
      try {
        const where = {};
        if (params.userId) {
          const uid = params.userId;
          const numericId = typeof uid === 'number' ? uid : (typeof uid === 'string' && /^\d+$/.test(uid) ? parseInt(uid, 10) : null);
          if (numericId != null) where.submitted_by_id = numericId;
        }
        if (params.dateFrom || params.dateTo) {
          where.submitted_at = {};
          if (params.dateFrom) where.submitted_at.$gte = params.dateFrom;
          if (params.dateTo) where.submitted_at.$lte = params.dateTo;
        }
        const raw = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: Object.keys(where).length > 0 ? where : undefined,
          limit: 5000,
        });
        if (Array.isArray(raw) && raw.length > 0) submissions = raw;
      } catch (e) {
        strapi.log.warn('Quiz db.query failed:', e?.message);
      }
    }
    // Filter in memory by userId and date when params provided
    if (params.userId || params.dateFrom || params.dateTo) {
      const numericUserId = params.userId != null && (typeof params.userId === 'number' || /^\d+$/.test(String(params.userId)))
        ? Number(params.userId)
        : null;
      const isDocId = typeof params.userId === 'string' && params.userId.length > 10 && !/^\d+$/.test(params.userId);
      submissions = submissions.filter((s) => {
        if (params.userId != null) {
          const subBy = s.submitted_by ?? s;
          const matchId = numericUserId != null && (subBy.id === numericUserId || subBy.id === params.userId);
          const matchDocId = isDocId && (subBy.documentId === params.userId || subBy.document_id === params.userId);
          if (!matchId && !matchDocId) return false;
        }
        if (params.dateFrom && (s.submitted_at || s.submittedAt) < params.dateFrom) return false;
        if (params.dateTo && (s.submitted_at || s.submittedAt) > params.dateTo) return false;
        return true;
      });
    }

    const passed = submissions.filter((s) => s.passed).length;
    const total = submissions.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const avgScore = total > 0 ? Math.round(submissions.reduce((sum, s) => sum + (s.score || 0), 0) / total) : 0;

    return {
      passRate,
      avgScore,
      totalAttempts: total,
      passed,
      failed: total - passed,
    };
  },

  /**
   * QUIZ ANALYTICS - Personal
   */
  async getQuizPersonal(userId, params = {}) {
    return this.getQuizGlobal({ ...params, userId });
  },

  /**
   * OVERALL ANALYTICS - Global
   */
  async getOverallGlobal(params = {}) {
    const emptyOverall = () => ({
      kpis: { totalUsers: 0, totalActiveUsers: 0, totalHolidays: 0, totalNews: 0, totalEvents: 0, totalTownhalls: 0 },
      holidayByMonth: [],
      employeesByCompany: [],
      activeUsersByCompany: [],
      newsByCategory: [],
      eventsByType: [],
      townhallByContentType: [],
    });
    try {
    const filters = {};

    if (params.dateFrom || params.dateTo) {
      filters.publishedAt = {};
      if (params.dateFrom) filters.publishedAt.$gte = params.dateFrom;
      if (params.dateTo) filters.publishedAt.$lte = params.dateTo;
    }

    // Only filter by company when it's a real value (not "All Companies" / empty)
    const companyFilter = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    if (companyFilter) filters.company = { name: params.company };

    // Count users (all non-blocked)
    const totalUsersWhere = { blocked: { $eq: false } };
    if (companyFilter) totalUsersWhere.company = params.company;
    let totalUsers = 0;
    try {
      totalUsers = await strapi.db.query('plugin::users-permissions.user').count({
        where: totalUsersWhere,
      });
    } catch (e) {
      strapi.log.warn('Overall global: totalUsers count failed:', e?.message);
    }

    // Count active users (non-blocked + active); user schema uses "active" not "is_active"
    let totalActiveUsers = 0;
    const activeUsersCountWhere = { blocked: { $eq: false }, active: { $eq: true } };
    if (companyFilter) activeUsersCountWhere.company = params.company;
    try {
      totalActiveUsers = await strapi.db.query('plugin::users-permissions.user').count({
        where: activeUsersCountWhere,
      });
    } catch (e) {
      strapi.log.warn('Overall global: totalActiveUsers count failed:', e?.message);
    }

    // Active users by company (for company-wise breakdown)
    let activeUsers = [];
    const activeUsersWhere = { blocked: { $eq: false }, active: { $eq: true } };
    if (companyFilter) activeUsersWhere.company = params.company;
    try {
      activeUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: activeUsersWhere,
        select: ['company'],
      }) || [];
    } catch (e) {
      strapi.log.warn('Overall global: activeUsers findMany failed:', e?.message);
    }
    if (!Array.isArray(activeUsers)) activeUsers = [];
    const activeUsersByCompany = {};
    activeUsers.forEach((u) => {
      const company = u.company || 'Unassigned';
      activeUsersByCompany[company] = (activeUsersByCompany[company] || 0) + 1;
    });

    // Holidays - by month (holiday has unit_location; news/event do not)
    let holidayFilters = { ...filters };
    if (params.unitLocation) {
      holidayFilters['unit_location'] = { id: params.unitLocation };
    }
    let holidays = [];
    try {
      holidays = await strapi.documents('api::holiday.holiday').findMany({
        filters: holidayFilters,
        status: 'published',
        limit: 1000,
        start: 0,
      });
    } catch (e) {
      strapi.log.warn('Overall global: holidays findMany failed:', e?.message);
    }
    const totalHolidays = Array.isArray(holidays) ? holidays.length : 0;
    const holidayByMonth = {};
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    holidays.forEach((h) => {
      if (h.date) {
        const d = new Date(h.date);
        const monthKey = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        holidayByMonth[monthKey] = (holidayByMonth[monthKey] || 0) + 1;
      }
    });

    // Employees by company (all non-blocked)
    let users = [];
    const employeesWhere = { blocked: { $eq: false } };
    if (companyFilter) employeesWhere.company = params.company;
    try {
      users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: employeesWhere,
        select: ['company'],
      }) || [];
    } catch (e) {
      strapi.log.warn('Overall global: users findMany failed:', e?.message);
    }
    if (!Array.isArray(users)) users = [];
    const employeesByCompany = {};
    users.forEach((u) => {
      const company = u.company || 'Unassigned';
      employeesByCompany[company] = (employeesByCompany[company] || 0) + 1;
    });

    // News
    let newsItems = [];
    try {
      newsItems = await strapi.documents('api::news.news').findMany({
        filters,
        status: 'published',
        populate: ['news_category'],
        limit: 1000,
        start: 0,
      });
    } catch (e) {
      strapi.log.warn('Overall global: news findMany failed:', e?.message);
    }
    if (!Array.isArray(newsItems)) newsItems = [];
    const newsByCategory = {};
    newsItems.forEach((n) => {
      const cat = n.news_category?.name || 'Uncategorized';
      newsByCategory[cat] = (newsByCategory[cat] || 0) + 1;
    });

    // Events
    let events = [];
    try {
      events = await strapi.documents('api::event.event').findMany({
        filters,
        status: 'published',
        limit: 500,
        start: 0,
      });
    } catch (e) {
      strapi.log.warn('Overall global: events findMany failed:', e?.message);
    }
    if (!Array.isArray(events)) events = [];
    const eventsByType = {};
    events.forEach((e) => {
      const t = e.event_type || 'Other';
      eventsByType[t] = (eventsByType[t] || 0) + 1;
    });

    // Townhall matrix (by content type: Video vs Pdf) - townhall has no company field, use date filters only
    const townhallFilters = {};
    if (params.dateFrom || params.dateTo) {
      townhallFilters.publishedAt = {};
      if (params.dateFrom) townhallFilters.publishedAt.$gte = params.dateFrom;
      if (params.dateTo) townhallFilters.publishedAt.$lte = params.dateTo;
    }
    let townhalls = [];
    try {
      townhalls = await strapi.documents('api::townhall.townhall').findMany({
        filters: townhallFilters,
        status: 'published',
        limit: 500,
        start: 0,
      });
    } catch (e) {
      strapi.log.warn('Overall global: townhalls findMany failed:', e?.message);
    }
    if (!Array.isArray(townhalls)) townhalls = [];
    const townhallByContentType = {};
    townhalls.forEach((t) => {
      const type = t.meeting_content_type || 'Other';
      townhallByContentType[type] = (townhallByContentType[type] || 0) + 1;
    });

    return {
      kpis: {
        totalUsers,
        totalActiveUsers,
        totalHolidays,
        totalNews: newsItems.length,
        totalEvents: events.length,
        totalTownhalls: townhalls.length,
      },
      holidayByMonth: Object.entries(holidayByMonth)
        .sort(([a], [b]) => {
          const parseMonth = (s) => {
            const [mon, year] = s.split(' ');
            const m = monthNames.indexOf(mon);
            return parseInt(year, 10) * 12 + m;
          };
          return parseMonth(a) - parseMonth(b);
        })
        .map(([name, value]) => ({ name, value })),
      employeesByCompany: Object.entries(employeesByCompany).map(([name, value]) => ({
        name,
        value,
        activeValue: activeUsersByCompany[name] || 0,
      })),
      activeUsersByCompany: Object.entries(activeUsersByCompany).map(([name, value]) => ({ name, value })),
      newsByCategory: Object.entries(newsByCategory).map(([name, value]) => ({ name, value })),
      eventsByType: Object.entries(eventsByType).map(([name, value]) => ({ name, value })),
      townhallByContentType: Object.entries(townhallByContentType).map(([name, value]) => ({ name, value })),
    };
    } catch (err) {
      strapi.log.error('Overall global error:', err?.message || err);
      return emptyOverall();
    }
  },

  /**
   * OVERALL ANALYTICS - Personal
   */
  async getOverallPersonal(userId, params = {}) {
    if (!userId) return null;

    const emptyOverallPersonal = () => ({
      kpis: { totalHolidays: 0 },
      holidayByMonth: [],
      employeesByCompany: [],
    });
    try {
    const filters = {};
    if (params.dateFrom || params.dateTo) {
      filters.publishedAt = {};
      if (params.dateFrom) filters.publishedAt.$gte = params.dateFrom;
      if (params.dateTo) filters.publishedAt.$lte = params.dateTo;
    }
    if (params.company) filters.company = { name: params.company };

    let holidays = [];
    try {
      holidays = await strapi.documents('api::holiday.holiday').findMany({
        filters,
        status: 'published',
        limit: 500,
        start: 0,
      });
    } catch (e) {
      strapi.log.warn('Overall personal: holidays findMany failed:', e?.message);
    }
    if (!Array.isArray(holidays)) holidays = [];
    const totalHolidays = holidays.length;
    const holidayByMonth = {};
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    holidays.forEach((h) => {
      if (h.date) {
        const d = new Date(h.date);
        const monthKey = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        holidayByMonth[monthKey] = (holidayByMonth[monthKey] || 0) + 1;
      }
    });

    // Personal view: show 100% of employee's company in Employees by Company donut
    let targetUser = null;
    try {
      targetUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: userId, blocked: { $eq: false } },
        select: ['company'],
      });
    } catch (e) {
      strapi.log.warn('Overall personal: targetUser findOne failed:', e?.message);
    }
    const employeesByCompany = {};
    if (targetUser?.company) {
      employeesByCompany[targetUser.company] = 1;
    } else {
      employeesByCompany['Unassigned'] = 1;
    }

    return {
      kpis: {
        totalHolidays,
      },
      holidayByMonth: Object.entries(holidayByMonth)
        .sort(([a], [b]) => {
          const parseMonth = (s) => {
            const [mon, year] = s.split(' ');
            const m = monthNames.indexOf(mon);
            return parseInt(year, 10) * 12 + m;
          };
          return parseMonth(a) - parseMonth(b);
        })
        .map(([name, value]) => ({ name, value })),
      employeesByCompany: Object.entries(employeesByCompany).map(([name, value]) => ({ name, value })),
    };
    } catch (err) {
      strapi.log.error('Overall personal error:', err?.message || err);
      return emptyOverallPersonal();
    }
  },

  /**
   * LEARNING ANALYTICS - Employee Table (Option B: one row per employee, aggregated)
   */
  async getLearningEmployeeTable(params = {}) {
    const userWhere = { blocked: { $eq: false } };
    if (params.company) userWhere.company = params.company;
    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      if (!Number.isNaN(numericId) && String(numericId) === search) {
        userWhere.id = numericId;
      } else {
        userWhere.$or = [
          { employee_name: { $containsi: search } },
          { email: { $containsi: search } },
          { username: { $containsi: search } },
        ];
      }
    }

    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;

    const totalCount = await strapi.db.query('plugin::users-permissions.user').count({
      where: userWhere,
    });

    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: userWhere,
      limit: pageSize,
      offset,
    });
    const userList = Array.isArray(users) ? users : [];
    if (userList.length === 0) return { rows: [], total: totalCount, page, pageSize };

    const userIdsNumeric = userList.map((u) => u.id).filter(Boolean);
    const userById = {};
    const userByDocumentId = {};
    userList.forEach((u, i) => {
      if (u.id != null) userById[u.id] = i;
      const docId = u.documentId ?? u.document_id;
      if (docId != null) userByDocumentId[String(docId)] = i;
    });

    const getUserIdx = (uid, docId, rawUserId, rawSubmittedById) => {
      if (uid != null && userById[uid] !== undefined) return userById[uid];
      if (docId != null && userByDocumentId[String(docId)] !== undefined) return userByDocumentId[String(docId)];
      if (rawUserId != null && userById[rawUserId] !== undefined) return userById[rawUserId];
      if (rawSubmittedById != null && userById[rawSubmittedById] !== undefined) return userById[rawSubmittedById];
      return undefined;
    };

    // Use Document Service for progress/submission - handles user relation correctly (id vs documentId)
    const progressFilters = { user: { id: { $in: userIdsNumeric } } };
    if (params.dateFrom || params.dateTo) {
      progressFilters.last_accessed_at = {};
      if (params.dateFrom) progressFilters.last_accessed_at.$gte = params.dateFrom;
      if (params.dateTo) progressFilters.last_accessed_at.$lte = params.dateTo;
    }

    let progressList = [];
    try {
      progressList = await strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'published',
        populate: ['user', 'course'],
        pagination: { limit: 10000 },
      });
      progressList = Array.isArray(progressList) ? progressList : [];
    } catch (e) {
      strapi.log.warn('Employee table: progress query failed:', e?.message);
      // Fallback to db.query if Document Service fails
      try {
        const progressWhere = { user_id: { $in: userIdsNumeric } };
        if (params.dateFrom || params.dateTo) {
          progressWhere.last_accessed_at = {};
          if (params.dateFrom) progressWhere.last_accessed_at.$gte = params.dateFrom;
          if (params.dateTo) progressWhere.last_accessed_at.$lte = params.dateTo;
        }
        progressList = await strapi.db.query('api::user-progress.user-progress').findMany({
          where: progressWhere,
          limit: 10000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table: db.query fallback failed:', e2?.message);
      }
    }

    // Filter progressList by courseId (support populated course or raw course id)
    if (params.courseId) {
      const courseIdStr = String(params.courseId);
      progressList = progressList.filter((p) => {
        const courseId = p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.course;
        return courseId != null && String(courseId) === courseIdStr;
      });
    }

    // Filter progressList by progress_status if status filter is applied
    if (params.status) {
      progressList = progressList.filter((p) => p.progress_status === params.status);
    }

    // Filter progressList by course completion time min/max
    if (params.filterTimeMin) {
      const min = Number(params.filterTimeMin);
      progressList = progressList.filter((p) => (p.time_spent_minutes ?? 0) >= min);
    }
    if (params.filterTimeMax) {
      const max = Number(params.filterTimeMax);
      progressList = progressList.filter((p) => (p.time_spent_minutes ?? 0) <= max);
    }

    const submissionFilters = { submitted_by: { id: { $in: userIdsNumeric } } };
    let submissionList = [];
    try {
      submissionList = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        filters: submissionFilters,
        status: 'published',
        populate: ['submitted_by'],
        pagination: { limit: 5000 },
      });
      submissionList = Array.isArray(submissionList) ? submissionList : [];
    } catch (e) {
      strapi.log.warn('Employee table: submission query failed:', e?.message);
      try {
        submissionList = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: { submitted_by_id: { $in: userIdsNumeric } },
          limit: 5000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table: submission db.query fallback failed:', e2?.message);
      }
    }

    // Group by user (support Document Service user.id/documentId and db.query user_id/submitted_by_id)
    const progressByUserIdx = {};
    const submissionByUserIdx = {};
    userList.forEach((_, i) => {
      progressByUserIdx[i] = [];
      submissionByUserIdx[i] = [];
    });
    progressList.forEach((p) => {
      const idx = getUserIdx(p.user?.id, p.user?.documentId, p.user_id, null);
      if (idx !== undefined) progressByUserIdx[idx].push(p);
    });
    submissionList.forEach((s) => {
      const idx = getUserIdx(s.submitted_by?.id, s.submitted_by?.documentId, null, s.submitted_by_id);
      if (idx !== undefined) submissionByUserIdx[idx].push(s);
    });

    let rows = userList.map((u, i) => {
      const progs = progressByUserIdx[i] || [];
      const subs = submissionByUserIdx[i] || [];
      const coursesEnrolled = progs.length;
      const totalTimeSpent = progs.reduce((sum, p) => sum + (p.time_spent_minutes || 0), 0);
      const totalModulesDone = progs.reduce((sum, p) => {
        const cm = p.completed_modules;
        return sum + (Array.isArray(cm) ? cm.length : 0);
      }, 0);
      const avgProgress = coursesEnrolled > 0
        ? Math.round(progs.reduce((s, p) => s + (p.progress_percentage || 0), 0) / coursesEnrolled)
        : 0;
      const quizPassed = subs.filter((s) => s.passed).length;
      const quizPassRate = subs.length > 0 ? Math.round((quizPassed / subs.length) * 100) : 0;
      const avgScore = subs.length > 0
        ? Math.round(subs.reduce((s, x) => s + (x.score || 0), 0) / subs.length)
        : 0;

      return {
        employeeId: u.id,
        employeeName: u.employee_name || u.username || u.email || `User ${u.id}`,
        company: u.company || '—',
        coursesEnrolled,
        courseCompletionTimeMinutes: totalTimeSpent,
        totalModulesDone,
        progressPercent: avgProgress,
        quizPassRate,
        avgScore,
      };
    });

    // If courseId filter is applied, only include users with progress records for that course
    // If courseId or status filter is applied, only include users with progress records for that course/status
    if (params.courseId || params.status) {
      rows = rows.filter((row, i) => (progressByUserIdx[i] || []).length > 0);
    }

    const sortBy = params.sortBy || 'courseCompletionTimeMinutes';
    const sortOrder = (params.sortOrder || 'desc').toLowerCase();
    rows.sort((a, b) => {
      const key = sortBy === 'courseCompletionTime' ? 'courseCompletionTimeMinutes' : sortBy;
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === 'string') return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortOrder === 'asc' ? av - bv : bv - av;
    });

    return { rows, total: totalCount, page, pageSize };
  },

  /**
   * Escape CSV value (wrap in quotes if contains comma, quote, or newline)
   */
  escapeCsvValue(val) {
    const s = String(val ?? '');
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  },

  /**
   * LEARNING ANALYTICS - Employee Table Export (CSV)
   * Same filters as getLearningEmployeeTable but returns all rows as CSV.
   */
  async getLearningEmployeeTableExport(params = {}) {
    const XLSX = require('xlsx');
    const result = await this.getLearningEmployeeTableForExport(params);
    
    // Prepare data for Excel
    const exportData = (result.rows || []).map((r) => ({
      'Employee Name': r.employeeName || '—',
      'Company': r.company || '—',
      'Courses Enrolled': r.coursesEnrolled || 0,
      'Total Modules Done': r.totalModulesDone || 0,
      'Progress %': r.progressPercent || 0,
      'Avg Quiz Score': r.avgScore || 0,
      'Course Completion Time (min)': r.courseCompletionTimeMinutes || 0,
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    // Auto-size columns
    const maxWidth = 50;
    const headers = ['Employee Name', 'Company', 'Courses Enrolled', 'Total Modules Done', 'Progress %', 'Avg Quiz Score', 'Course Completion Time (min)'];
    const wscols = headers.map((header) => {
      const maxLen = Math.max(
        header.length,
        ...exportData.map((row) => String(row[header] || '').length)
      );
      return { wch: Math.min(maxLen + 2, maxWidth) };
    });
    ws['!cols'] = wscols;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Employee Learning Summary');

    // Write to buffer
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  },

  /**
   * Internal: Employee table data for export (all rows, no pagination)
   */
  async getLearningEmployeeTableForExport(params = {}) {
    const userWhere = { blocked: { $eq: false } };
    if (params.company) userWhere.company = params.company;
    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      if (!Number.isNaN(numericId) && String(numericId) === search) {
        userWhere.id = numericId;
      } else {
        userWhere.$or = [
          { employee_name: { $containsi: search } },
          { email: { $containsi: search } },
          { username: { $containsi: search } },
        ];
      }
    }

    const maxExport = 10000;
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: userWhere,
      limit: maxExport,
    });
    const userList = Array.isArray(users) ? users : [];
    if (userList.length === 0) return { rows: [] };

    const userIdsNumeric = userList.map((u) => u.id).filter(Boolean);
    const userById = {};
    const userByDocumentId = {};
    userList.forEach((u, i) => {
      if (u.id != null) userById[u.id] = i;
      const docId = u.documentId ?? u.document_id;
      if (docId != null) userByDocumentId[String(docId)] = i;
    });
    const getUserIdxExport = (uid, docId, rawUserId, rawSubmittedById) => {
      if (uid != null && userById[uid] !== undefined) return userById[uid];
      if (docId != null && userByDocumentId[String(docId)] !== undefined) return userByDocumentId[String(docId)];
      if (rawUserId != null && userById[rawUserId] !== undefined) return userById[rawUserId];
      if (rawSubmittedById != null && userById[rawSubmittedById] !== undefined) return userById[rawSubmittedById];
      return undefined;
    };

    const progressFilters = { user: { id: { $in: userIdsNumeric } } };
    if (params.dateFrom || params.dateTo) {
      progressFilters.last_accessed_at = {};
      if (params.dateFrom) progressFilters.last_accessed_at.$gte = params.dateFrom;
      if (params.dateTo) progressFilters.last_accessed_at.$lte = params.dateTo;
    }

    let progressList = [];
    try {
      progressList = await strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'published',
        populate: ['user', 'course'],
        pagination: { limit: 50000 },
      }) || [];
    } catch (e) {
      strapi.log.warn('Employee table export: progress query failed:', e?.message);
      try {
        const progressWhere = { user_id: { $in: userIdsNumeric } };
        if (params.dateFrom || params.dateTo) {
          progressWhere.last_accessed_at = {};
          if (params.dateFrom) progressWhere.last_accessed_at.$gte = params.dateFrom;
          if (params.dateTo) progressWhere.last_accessed_at.$lte = params.dateTo;
        }
        progressList = await strapi.db.query('api::user-progress.user-progress').findMany({
          where: progressWhere,
          limit: 50000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table export: db.query fallback failed:', e2?.message);
      }
    }
    progressList = Array.isArray(progressList) ? progressList : [];
    if (params.courseId) {
      const courseIdStr = String(params.courseId);
      progressList = progressList.filter((p) => {
        const courseId = p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.course;
        return courseId != null && String(courseId) === courseIdStr;
      });
    }
    if (params.status) {
      progressList = progressList.filter((p) => p.progress_status === params.status);
    }
    if (params.filterTimeMin) {
      const min = Number(params.filterTimeMin);
      progressList = progressList.filter((p) => (p.time_spent_minutes ?? 0) >= min);
    }
    if (params.filterTimeMax) {
      const max = Number(params.filterTimeMax);
      progressList = progressList.filter((p) => (p.time_spent_minutes ?? 0) <= max);
    }

    let submissionList = [];
    try {
      submissionList = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        filters: { submitted_by: { id: { $in: userIdsNumeric } } },
        status: 'published',
        populate: ['submitted_by'],
        pagination: { limit: 20000 },
      }) || [];
    } catch (e) {
      strapi.log.warn('Employee table export: submission query failed:', e?.message);
      try {
        submissionList = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: { submitted_by_id: { $in: userIdsNumeric } },
          limit: 20000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table export: submission fallback failed:', e2?.message);
      }
    }

    const progressByUserIdx = {};
    const submissionByUserIdx = {};
    userList.forEach((_, i) => {
      progressByUserIdx[i] = [];
      submissionByUserIdx[i] = [];
    });
    progressList.forEach((p) => {
      const idx = getUserIdxExport(p.user?.id, p.user?.documentId, p.user_id, null);
      if (idx !== undefined) progressByUserIdx[idx].push(p);
    });
    submissionList.forEach((s) => {
      const idx = getUserIdxExport(s.submitted_by?.id, s.submitted_by?.documentId, null, s.submitted_by_id);
      if (idx !== undefined) submissionByUserIdx[idx].push(s);
    });

    let rows = userList.map((u, i) => {
      const progs = progressByUserIdx[i] || [];
      const subs = submissionByUserIdx[i] || [];
      const coursesEnrolled = progs.length;
      const totalTimeSpent = progs.reduce((sum, p) => sum + (p.time_spent_minutes || 0), 0);
      const totalModulesDone = progs.reduce((sum, p) => sum + (Array.isArray(p.completed_modules) ? p.completed_modules.length : 0), 0);
      const avgProgress =
        coursesEnrolled > 0
          ? Math.round(progs.reduce((s, p) => s + (p.progress_percentage || 0), 0) / coursesEnrolled)
          : 0;
      const avgScore =
        subs.length > 0 ? Math.round(subs.reduce((s, x) => s + (x.score || 0), 0) / subs.length) : 0;

      return {
        employeeName: u.employee_name || u.username || u.email || `User ${u.id}`,
        company: u.company || '—',
        coursesEnrolled,
        totalModulesDone,
        progressPercent: avgProgress,
        avgScore,
        courseCompletionTimeMinutes: totalTimeSpent,
      };
    });
    if (params.courseId || params.status) {
      rows = rows.filter((_, i) => (progressByUserIdx[i] || []).length > 0);
    }

    const sortBy = params.sortBy || 'courseCompletionTimeMinutes';
    const sortOrder = (params.sortOrder || 'desc').toLowerCase();
    rows.sort((a, b) => {
      const key = sortBy === 'courseCompletionTime' ? 'courseCompletionTimeMinutes' : sortBy;
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === 'string') return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortOrder === 'asc' ? av - bv : bv - av;
    });

    return { rows };
  },

  /**
   * Get courses for filter dropdown. Optional departmentId = courses from assignments to that dept. Optional company = courses that have that company (course.company relation).
   * Course schema has company (manyToMany) – when company selected, filter courses by course.company. When department selected, use course_assignments for that department.
   */
  async getCoursesByDepartment(departmentId, company) {
    try {
      const companyId = company != null && company !== '' ? await this.resolveCompanyId(company) : null;

      // Company selected, no department: get courses directly from course table where course.company contains this company
      if ((departmentId == null || departmentId === '') && companyId != null) {
        const list = await this._getCoursesByCompanyId(companyId);
        return list;
      }

      // Department selected: get courses from course_assignments where target is Department and this dept is linked
      let assignments = [];
      if (departmentId != null && departmentId !== '') {
        let numericDept = typeof departmentId === 'number' ? departmentId : parseInt(String(departmentId), 10);
        const isDocId = typeof departmentId === 'string' && departmentId.length > 10;
        if (Number.isNaN(numericDept) && isDocId) {
          const deptRow = await strapi.db.query('api::department.department').findOne({
            where: { documentId: departmentId },
            select: ['id'],
          });
          if (deptRow && deptRow.id != null) numericDept = Number(deptRow.id);
        }
        // Only assignments with target Department have departments relation; filter by id and optionally by documentId
        if (!Number.isNaN(numericDept)) {
          const byDept = await strapi.db.query('api::course-assignment.course-assignment').findMany({
            where: { assignment_target_type: 'Department', departments: { id: numericDept } },
            populate: ['course'],
            limit: 500,
          });
          assignments = byDept || [];
        }
        if (assignments.length === 0 && isDocId) {
          const byDocId = await strapi.db.query('api::course-assignment.course-assignment').findMany({
            where: { assignment_target_type: 'Department', departments: { documentId: departmentId } },
            populate: ['course'],
            limit: 500,
          });
          if (byDocId && byDocId.length > 0) assignments = byDocId;
        }
      }

      if (assignments.length === 0) return [];
      const courseIds = new Set();
      const courses = [];
      const numericCourseIds = [];
      assignments.forEach((a) => {
        const c = a.course;
        let cid = c != null ? (c.id ?? c.documentId ?? c.document_id ?? (typeof c === 'object' ? null : c)) : null;
        if (cid == null && a != null) cid = a.course_id ?? a.courseId ?? a.course;
        if (cid != null && !courseIds.has(cid)) {
          courseIds.add(cid);
          if (typeof cid === 'number' || /^\d+$/.test(String(cid))) numericCourseIds.push(Number(cid));
          const title = (c && typeof c === 'object' && (c.title != null || c.attributes?.title != null)) ? (c.title ?? c.attributes?.title) : null;
          courses.push({ id: cid, title: title ?? `Course ${cid}` });
        }
      });
      if (courses.some((x) => x.title === `Course ${x.id}`) && numericCourseIds.length > 0) {
        const courseRows = await strapi.db.query('api::course.course').findMany({
          where: { id: { $in: numericCourseIds } },
          select: ['id', 'documentId', 'title'],
        });
        const byId = {};
        (courseRows || []).forEach((row) => { byId[row.id] = row; if (row.documentId) byId[row.documentId] = row; });
        courses.forEach((co) => { const row = byId[co.id]; if (row && row.title) co.title = row.title; });
      }
      courses.sort((a, b) => String(a.title).localeCompare(String(b.title)));
      return courses;
    } catch (e) {
      strapi.log.error('getCoursesByDepartment error:', e?.message || e);
      return [];
    }
  },

  /**
   * Get courses that have the given company (course.company relation). Course schema has company manyToMany.
   */
  async _getCoursesByCompanyId(companyId) {
    const companyIdStr = String(companyId);
    const toResult = (list) => (list || []).map((c) => ({
      id: c.id ?? c.documentId,
      title: c.title ?? c.attributes?.title ?? `Course ${c.id ?? c.documentId}`,
    })).sort((a, b) => String(a.title).localeCompare(String(b.title)));

    try {
      let list = [];
      try {
        const docList = await strapi.documents('api::course.course').findMany({
          status: 'published',
          filters: { company: { id: companyId } },
          limit: 500,
        });
        list = Array.isArray(docList) ? docList : [];
      } catch (_) {}
      if (list.length === 0) {
        try {
          const rows = await strapi.db.query('api::course.course').findMany({
            where: { company: { id: companyId } },
            orderBy: { title: 'asc' },
            limit: 500,
            select: ['id', 'documentId', 'title'],
          });
          list = rows || [];
        } catch (_) {}
      }
      if (list.length > 0) return toResult(list);

      // Fallback: fetch all courses with company populated and filter in memory (handles relation filter quirks)
      try {
        const all = await strapi.db.query('api::course.course').findMany({
          orderBy: { title: 'asc' },
          limit: 1000,
          populate: ['company'],
        });
        const filtered = (all || []).filter((c) => {
          const comp = c.company;
          if (!comp) return false;
          const arr = Array.isArray(comp) ? comp : [comp];
          return arr.some((x) => x && (x.id === companyId || x.id === Number(companyId) || String(x.id) === companyIdStr || x.documentId === companyIdStr || x.document_id === companyIdStr));
        });
        return toResult(filtered);
      } catch (e) {
        strapi.log.warn('_getCoursesByCompanyId fallback:', e?.message || e);
        return [];
      }
    } catch (e) {
      strapi.log.warn('_getCoursesByCompanyId error:', e?.message || e);
      return [];
    }
  },

  /**
   * Get courses that have the given company (for Course dropdown when Company selected)
   */
  async getCoursesByCompany(company) {
    const companyId = await this.resolveCompanyId(company);
    if (companyId == null) return [];
    return this._getCoursesByCompanyId(companyId);
  },
};
};
