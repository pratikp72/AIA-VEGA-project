'use strict';

/**
 * Analytics Service - Aggregates data for analytics dashboards
 */

module.exports = ({ strapi }) => ({
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
   * LEARNING ANALYTICS - Global (all employees)
   */
  async getLearningGlobal(params = {}) {
    const emptyResponse = () => ({
      kpis: { totalAssignments: 0, completionRate: 0, avgTimeSpentMinutes: 0, certificatesIssued: 0 },
      statusDistribution: [],
      categoryDistribution: [],
      departmentDistribution: [],
      monthlyCompletions: [],
    });
    try {
    let progresses = [];
    // 1) Prefer Document Service (published records) so dashboards show seeded/published data
    try {
      progresses = await strapi.documents('api::user-progress.user-progress').findMany({
        status: 'published',
        populate: ['user', 'course', 'course.course_category'],
        limit: 5000,
        start: 0,
      });
      if (!Array.isArray(progresses)) progresses = [];
    } catch (e2) {
      strapi.log.warn('Learning global: document findMany failed:', e2?.message || String(e2));
    }
    // 2) Fallback to db.query if Document Service returned nothing (e.g. no draft/publish)
    if (progresses.length === 0) {
      try {
        const where = {};
        if (params.dateFrom || params.dateTo) {
          where.last_accessed_at = {};
          if (params.dateFrom) where.last_accessed_at.$gte = params.dateFrom;
          if (params.dateTo) where.last_accessed_at.$lte = params.dateTo;
        }
        const raw = await strapi.db.query('api::user-progress.user-progress').findMany({
          where: Object.keys(where).length > 0 ? where : undefined,
          limit: 5000,
          populate: { course: true, user: true },
        });
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
          const [courses, users] = await Promise.all([
            numericCourseIds.length > 0 ? strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericCourseIds.map(Number) } } }) : [],
            userIdsRaw.length > 0 ? strapi.db.query('plugin::users-permissions.user').findMany({ where: { id: { $in: userIdsRaw } }, populate: ['department'] }) : [],
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
            return {
              ...r,
              user: userById[uid] || r.user || null,
              user_id: uid,
              course: course ? { ...course, course_category: cat } : null,
            };
          });
        }
      } catch (e) {
        strapi.log.warn('Learning global: db.query failed:', e?.message);
      }
    }
    // Apply filters in memory (date, company, department) so we don't over-filter
    const wantCompany = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const wantDept = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    const wantDateFrom = params.dateFrom;
    const wantDateTo = params.dateTo;
    if (wantCompany || wantDept || wantDateFrom || wantDateTo) {
      progresses = progresses.filter((p) => {
        if (wantDateFrom && p.last_accessed_at && p.last_accessed_at < wantDateFrom) return false;
        if (wantDateTo && p.last_accessed_at && p.last_accessed_at > wantDateTo) return false;
        if (wantCompany) {
          const userCompany = p.user?.company;
          if (userCompany !== wantCompany) return false;
        }
        if (wantDept) {
          const deptId = p.user?.department?.id ?? p.user?.department;
          const deptName = p.user?.department?.name;
          if (deptId != params.department && deptName != params.department) return false;
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

    progresses.forEach((p) => {
      statusCounts[p.progress_status] = (statusCounts[p.progress_status] || 0) + 1;
      totalTimeSpent += p.time_spent_minutes || 0;
      if (p.certificate_issued) certificatesIssued++;

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

    return {
      kpis: {
        totalAssignments: total,
        completionRate,
        avgTimeSpentMinutes: avgTimeSpent,
        certificatesIssued,
      },
      statusDistribution: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
      categoryDistribution: Object.entries(categoryCounts).map(([name, value]) => ({ name, value })),
      departmentDistribution: Object.entries(departmentCounts).map(([name, value]) => ({ name, value })),
      monthlyCompletions: Object.entries(monthlyCompletions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({ month, value })),
    };
    } catch (err) {
      strapi.log.error('Learning global error:', err?.message || err);
      return emptyResponse();
    }
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

    // Deduplicate by course: one row per course in "My Course" table (prefer Completed, then most recent last_accessed_at)
    const courseKey = (p) => (p.course?.documentId ?? p.course?.document_id ?? p.course?.id ?? p.course_id ?? p.courseId ?? p.course ?? '').toString();
    const statusOrder = { Completed: 0, In_progress: 1, Failed: 2, Not_started: 3 };
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

    return {
      kpis: {
        totalCourses: total,
        completionRate,
        avgTimeSpentMinutes: avgTimeSpent,
        certificatesEarned: progressesDedup.filter((p) => p.certificate_issued).length,
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
    // 1) Document Service with user filter
    if (numericUserId != null) {
      try {
        const filters = { user: { id: numericUserId } };
        if (params.dateFrom || params.dateTo) {
          filters.last_updated = {};
          if (params.dateFrom) filters.last_updated.$gte = params.dateFrom;
          if (params.dateTo) filters.last_updated.$lte = params.dateTo;
        }
        const docRecords = await strapi.documents('api::module-video-progress.module-video-progress').findMany({
          status: 'published',
          filters,
          populate: ['course'],
          limit: 1000,
          start: 0,
        });
        if (Array.isArray(docRecords) && docRecords.length > 0) records = docRecords;
      } catch (e2) {
        strapi.log.warn('Module video progress document findMany failed:', e2?.message || String(e2));
      }
    }
    // 2) Fallback: db.query (try user_id then user) with course populated
    if (records.length === 0 && numericUserId != null) {
      for (const userKey of ['user_id', 'user']) {
        try {
          const where = { [userKey]: userKey === 'user' ? { id: numericUserId } : numericUserId };
          if (params.dateFrom || params.dateTo) {
            const dateFilter = {};
            if (params.dateFrom) dateFilter.$gte = params.dateFrom;
            if (params.dateTo) dateFilter.$lte = params.dateTo;
            // @ts-ignore - Dynamic query builder
            where['last_updated'] = dateFilter;
          }
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
          strapi.log.warn('Module video progress db.query failed (userKey=' + userKey + '):', e?.message || String(e));
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

    const kpis = { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 };
    const typeToKpi = { full_watch: 'watchedFully', skipped_to_end: 'skippedToEnd', in_progress: 'inProgress', not_started: 'notStarted' };
    const progress = (recordsWithCourse || []).map((r) => {
      const type = r.video_completion_type ?? r.videoCompletionType ?? 'not_started';
      const kpiKey = typeToKpi[type];
      if (kpiKey) kpis[kpiKey] += 1;
      const courseId = r.course?.documentId ?? r.course?.document_id ?? r.course?.id ?? r.course_id ?? r.courseId;
      const courseTitle = r.course?.title ?? 'Unknown';
      const moduleTitle = r.module_title ?? r.moduleTitle ?? (r.module_index != null ? `Module ${(r.module_index ?? r.moduleIndex) + 1}` : 'Unknown');
      const timeWat = r.time_watched_seconds != null ? r.time_watched_seconds : (r.timeWatchedSeconds ?? 0);
      const duration = r.video_duration_seconds != null ? r.video_duration_seconds : (r.videoDurationSeconds ?? 0);
      return {
        courseId: courseId != null ? String(courseId) : null,
        courseTitle,
        moduleTitle,
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
        populate: ['user'],
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

    const rows = userList.map((u, i) => {
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
        populate: ['user'],
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

    const rows = userList.map((u, i) => {
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
   * Get employee list for filter dropdown and personal view search
   */
  async getEmployeesList(params = {}) {
    const where = { blocked: { $eq: false } };
    // Only filter by company/department when meaningful (not "All Companies" / empty)
    const companyVal = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const deptVal = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    if (companyVal) where.company = params.company;
    if (deptVal) where.department = { id: params.department };

    // Search by ID, email, or employee_name (for personal view)
    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      if (!Number.isNaN(numericId) && String(numericId) === search) {
        where.id = numericId;
      } else {
        // Search by email first (most common); fallback to employee_name via $or if supported
        where.$or = [
          { email: { $containsi: search } },
          { employee_name: { $containsi: search } },
        ];
      }
    }

    try {
      // designation is a string on user schema, not a relation - do not populate
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where,
        populate: ['department'],
        orderBy: { employee_name: 'ASC' },
        limit: params.search ? 20 : 500,
      });

      const list = Array.isArray(users) ? users : [];
      return list.map((u) => ({
        id: u.id,
        documentId: u.documentId ?? u.document_id ?? null,
        employee_name: u.employee_name || u.username || u.email || '—',
        email: u.email || '—',
        department: u.department?.name ?? '—',
        designation: typeof u.designation === 'string' ? u.designation : (u.designation?.title ?? '—'),
        company: u.company ?? '—',
      }));
    } catch (e) {
      strapi.log.error('getEmployeesList error:', e?.message || e);
      return [];
    }
  },

  /**
   * Get department list for filter dropdown
   */
  async getDepartmentsList() {
    try {
      const departments = await strapi.documents('api::department.department').findMany({
        status: 'published',
        sort: [{ name: 'asc' }],
        limit: 200,
        start: 0,
      });
      const list = Array.isArray(departments) ? departments : [];
      return list.map((d) => ({ id: d.id ?? d.documentId, documentId: d.documentId, name: d.name }));
    } catch (e) {
      strapi.log.error('getDepartmentsList error:', e?.message || e);
      return [];
    }
  },

  /**
   * Get unit location list for filter dropdown (Overall dashboard)
   */
  async getUnitLocationsList() {
    try {
      const locations = await strapi.documents('api::unit-location.unit-location').findMany({
        status: 'published',
        sort: [{ name: 'asc' }],
        limit: 200,
        start: 0,
      });
      const list = Array.isArray(locations) ? locations : [];
      return list.map((l) => ({ id: l.id ?? l.documentId, documentId: l.documentId, name: l.name }));
    } catch (e) {
      strapi.log.error('getUnitLocationsList error:', e?.message || e);
      return [];
    }
  },

  /**
   * ACTIVITY TRACKING - Time spent by activity type and day (for line chart)
   */
  async getActivityTimeByTypeAndDay(params = {}) {
    const where = {};
    if (params.dateFrom || params.dateTo) {
      where.timestamp = {};
      if (params.dateFrom) where.timestamp.$gte = params.dateFrom;
      if (params.dateTo) where.timestamp.$lte = params.dateTo;
    }

    if (params.unitLocation) {
      const userWhere = { department: { unit_locations: { id: params.unitLocation } } };
      if (params.company) userWhere.company = params.company;
      if (params.department) userWhere.department = { id: params.department, unit_locations: { id: params.unitLocation } };
      const usersMatch = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: userWhere,
        select: ['id'],
      });
      const allowedUserIds = (usersMatch || []).map((u) => u.id);
      if (allowedUserIds.length === 0) {
        return [];
      }
      where.user_id = { $in: allowedUserIds };
    } else if (params.company || params.department) {
      where.user = where.user || {};
      if (params.company) where.user.company = params.company;
      if (params.department) where.user.department = { id: params.department };
    }

    if (params.activityType) {
      where.activity_type = params.activityType;
    }

    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 10000,
    });
    const list = Array.isArray(logs) ? logs : [];

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDate = {};
    list.forEach((log) => {
      if (!log.timestamp) return;
      const d = new Date(log.timestamp);
      const dateKey = log.timestamp.slice(0, 10);
      const dayKey = dayNames[d.getDay()];
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, day: dayKey, News_Reading: 0, Event_Info: 0, Townhall_Video: 0, Townhall_PDF: 0, Holiday_View: 0 };
      }
      const type = log.activity_type || 'News_Reading';
      const mins = log.activity_duration || 0;
      if (byDate[dateKey][type] !== undefined) {
        byDate[dateKey][type] += mins;
      } else {
        byDate[dateKey][type] = mins;
      }
    });

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  },

  /**
   * ACTIVITY TRACKING - Recent activity log (paginated table)
   */
  async getActivityLog(params = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(params.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;

    const where = {};
    if (params.dateFrom || params.dateTo) {
      where.timestamp = {};
      if (params.dateFrom) where.timestamp.$gte = params.dateFrom;
      if (params.dateTo) where.timestamp.$lte = params.dateTo;
    }

    let allowedUserIds = null;
    if (params.unitLocation) {
      const userWhere = { department: { unit_locations: { id: params.unitLocation } } };
      if (params.company) userWhere.company = params.company;
      if (params.department) userWhere.department = { id: params.department, unit_locations: { id: params.unitLocation } };
      const usersMatch = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: userWhere,
        select: ['id'],
      });
      allowedUserIds = (usersMatch || []).map((u) => u.id);
      if (allowedUserIds.length === 0) {
        return { rows: [], total: 0, page, pageSize };
      }
      where.user_id = { $in: allowedUserIds };
    } else if (params.company || params.department) {
      where.user = where.user || {};
      if (params.company) where.user.company = params.company;
      if (params.department) where.user.department = { id: params.department };
    }

    if (params.activityType) {
      where.activity_type = params.activityType;
    }

    const total = await strapi.db.query('api::activity-log.activity-log').count({ where });

    let list = [];
    try {
      const docs = await strapi.documents('api::activity-log.activity-log').findMany({
        filters: where,
        populate: ['user', 'company'],
        sort: 'timestamp:desc',
        start: offset,
        limit: pageSize,
      });
      list = Array.isArray(docs) ? docs : [];
    } catch (docErr) {
      strapi.log.warn('Activity log documents findMany failed, using db.query:', docErr?.message);
      const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
        where,
        limit: pageSize,
        offset,
        orderBy: { timestamp: 'desc' },
        populate: ['user', 'company'],
      });
      list = Array.isArray(logs) ? logs : [];
    }

    const rows = list.map((log) => {
      const mins = log.activity_duration || 0;
      const secs = mins * 60;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      let duration;
      if (mins === 0) {
        duration = 0;
      } else if (s === 0) {
        duration = `${m}m`;
      } else {
        duration = `${m}m ${s}s`;
      }
      const userName = log.user
        ? (log.user.employee_name || log.user.username || log.user.email || `User ${log.user.id}`)
        : '—';
      const companyName = log.company?.name ?? log.user?.company ?? '—';
      return {
        userName,
        company: companyName,
        activity: log.activity_type || log.activity_description || '—',
        duration,
        timestamp: log.timestamp,
      };
    });

    return { rows, total, page, pageSize };
  },

  /**
   * Create activity log entry (for frontend tracking).
   * Used when real users perform actions on the portal.
   * company: company_id (relation) or user.company string (AIA/Vega) - resolved to company relation.
   */
  async createActivityLog(data) {
    const { user_id, company, activity_type, activity_description, duration_seconds } = data;
    if (!user_id || !activity_type || !activity_description) {
      throw new Error('user_id, activity_type, and activity_description are required');
    }

    let companyId = null;
    if (company) {
      if (typeof company === 'number' || (typeof company === 'string' && /^\d+$/.test(company))) {
        companyId = typeof company === 'number' ? company : parseInt(company, 10);
      } else {
        const c = await strapi.db.query('api::company.company').findOne({
          where: { name: { $eqi: String(company) } },
          select: ['id'],
        });
        if (c) companyId = c.id;
      }
    }

    const entry = await strapi.documents('api::activity-log.activity-log').create({
      data: {
        user: user_id,
        company: companyId || undefined,
        activity_type,
        activity_description,
        activity_duration: Math.round(Math.max(0, duration_seconds || 0) / 60),
        timestamp: new Date().toISOString(),
      },
    });
    return entry;
  },
});
