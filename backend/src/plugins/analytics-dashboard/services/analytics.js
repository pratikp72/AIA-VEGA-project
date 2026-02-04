'use strict';

/**
 * Analytics Service - Aggregates data for analytics dashboards
 */

module.exports = ({ strapi }) => ({
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

    // Merge user filters (department + company)
    if (params.department || params.company) {
      filters.user = {};
      if (params.department) filters.user.department = { id: params.department };
      if (params.company) filters.user.company = params.company;
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

    const filters = this.buildFilters(params);

    let progresses = [];
    try {
      // Strapi 5 Document Service: use limit/start (not pagination object)
      progresses = await strapi.documents('api::user-progress.user-progress').findMany({
        filters,
        status: 'published',
        populate: ['user', 'course', 'course.course_category'],
        limit: 5000,
        start: 0,
      });
      if (!Array.isArray(progresses)) progresses = [];
    } catch (e) {
      strapi.log.error('Learning global: user-progress findMany failed:', e?.message || e);
      return emptyResponse();
    }

    // Build userId -> department name map (user.department may not populate via Document Service for plugin::users-permissions)
    // Strapi 5 Document Service returns relations with documentId (string); support both id and documentId for query
    const userIds = [...new Set(progresses.map((p) => p.user?.documentId ?? p.user?.id).filter(Boolean))];
    const departmentByUserId = {};
    if (userIds.length > 0) {
      const numericIds = userIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
      const documentIds = userIds.filter((x) => typeof x === 'string' && x.length > 10 && !/^\d+$/.test(x));
      const where =
        numericIds.length > 0 && documentIds.length > 0
          ? { $or: [{ id: { $in: numericIds.map(Number) } }, { documentId: { $in: documentIds } }] }
          : documentIds.length > 0
            ? { documentId: { $in: documentIds } }
            : { id: { $in: numericIds.map(Number) } };
      let users = [];
      try {
        users = (await strapi.db.query('plugin::users-permissions.user').findMany({
          where,
          populate: ['department'],
        })) || [];
      } catch (e) {
        strapi.log.warn('Learning global: user/department lookup failed:', e?.message);
        // Fallback: if documentId not supported (e.g. plugin not migrated), retry with id only
        if (numericIds.length > 0) {
          try {
            users = (await strapi.db.query('plugin::users-permissions.user').findMany({
              where: { id: { $in: numericIds.map(Number) } },
              populate: ['department'],
            })) || [];
          } catch (e2) {
            strapi.log.warn('Learning global: fallback user lookup failed:', e2?.message);
          }
        }
      }
      users.forEach((u) => {
        const deptName = u.department?.name;
        if (deptName) {
          if (u.id != null) departmentByUserId[u.id] = deptName;
          if (u.documentId != null) departmentByUserId[u.documentId] = deptName;
        }
      });
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

      if (p.course?.course_category?.name) {
        categoryCounts[p.course.course_category.name] = (categoryCounts[p.course.course_category.name] || 0) + 1;
      }

      const userId = p.user?.id ?? p.user?.documentId;
      const deptName = p.user?.department?.name ?? (userId ? departmentByUserId[userId] : null);
      if (deptName) {
        departmentCounts[deptName] = (departmentCounts[deptName] || 0) + 1;
      }

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

    const filters = this.buildFilters(params);
    const isDocumentId = typeof userId === 'string' && userId.length > 10 && !/^\d+$/.test(userId);
    filters.user = isDocumentId ? { documentId: userId } : { id: userId };

    let progresses = [];
    try {
      progresses = await strapi.documents('api::user-progress.user-progress').findMany({
        filters,
        status: 'published',
        populate: ['course', 'course.course_category'],
        limit: 500,
        start: 0,
      });
      if (!Array.isArray(progresses)) progresses = [];
    } catch (e) {
      strapi.log.error('Learning personal: user-progress findMany failed:', e?.message || e);
      return emptyResponse();
    }

    const statusCounts = { Not_started: 0, In_progress: 0, Completed: 0, Failed: 0 };
    let totalTimeSpent = 0;
    const courseProgress = [];
    const monthlyCompletions = {};
    const categoryCounts = {};
    const departmentCounts = {};

    progresses.forEach((p) => {
      statusCounts[p.progress_status] = (statusCounts[p.progress_status] || 0) + 1;
      totalTimeSpent += p.time_spent_minutes || 0;

      if (p.course?.course_category?.name) {
        categoryCounts[p.course.course_category.name] = (categoryCounts[p.course.course_category.name] || 0) + 1;
      }

      courseProgress.push({
        courseTitle: p.course?.title || 'Unknown',
        courseCategory: p.course?.course_category?.name || '—',
        status: p.progress_status,
        percentage: p.progress_percentage || 0,
        timeSpentMinutes: p.time_spent_minutes || 0,
        completedAt: p.completed_at,
        certificateIssued: p.certificate_issued,
      });

      if (p.completed_at && p.progress_status === 'Completed') {
        const month = p.completed_at.slice(0, 7);
        monthlyCompletions[month] = (monthlyCompletions[month] || 0) + 1;
      }
    });

    if (progresses.length > 0) {
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
      const deptName = u?.department?.name || 'Unknown';
      departmentCounts[deptName] = progresses.length;
    }

    const total = progresses.length;
    const completed = statusCounts.Completed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgTimeSpent = total > 0 ? Math.round(totalTimeSpent / total) : 0;

    return {
      kpis: {
        totalCourses: total,
        completionRate,
        avgTimeSpentMinutes: avgTimeSpent,
        certificatesEarned: progresses.filter((p) => p.certificate_issued).length,
      },
      statusDistribution: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
      categoryDistribution: Object.entries(categoryCounts).map(([name, value]) => ({ name, value })),
      departmentDistribution: Object.entries(departmentCounts).map(([name, value]) => ({ name, value })),
      courseProgress,
      monthlyCompletions: Object.entries(monthlyCompletions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({ month, value })),
    };
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

    const isDocumentId = typeof userId === 'string' && userId.length > 10 && !/^\d+$/.test(userId);
    const filters = { user: isDocumentId ? { documentId: userId } : { id: userId } };
    if (params.dateFrom || params.dateTo) {
      filters.last_updated = {};
      if (params.dateFrom) filters.last_updated.$gte = params.dateFrom;
      if (params.dateTo) filters.last_updated.$lte = params.dateTo;
    }

    let records = [];
    try {
      records = await strapi.documents('api::module-video-progress.module-video-progress').findMany({
        filters,
        status: 'published',
        populate: ['course'],
        limit: 1000,
        start: 0,
      });
    } catch (e) {
      strapi.log.warn('Module video progress fetch failed (table may not exist yet):', e.message);
      return {
        moduleVideoKpis: { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 },
        moduleVideoProgress: [],
      };
    }

    const kpis = { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 };
    const typeToKpi = { full_watch: 'watchedFully', skipped_to_end: 'skippedToEnd', in_progress: 'inProgress', not_started: 'notStarted' };
    const progress = (records || []).map((r) => {
      const type = r.video_completion_type || 'not_started';
      const kpiKey = typeToKpi[type];
      if (kpiKey) kpis[kpiKey] += 1;
      const courseTitle = r.course?.title || 'Unknown';
      const moduleTitle = r.module_title || (r.module_index != null ? `Module ${r.module_index + 1}` : 'Unknown');
      const timeWat = r.time_watched_seconds != null ? r.time_watched_seconds : 0;
      const duration = r.video_duration_seconds != null ? r.video_duration_seconds : 0;
      return {
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
    const filters = {};

    if (params.userId) {
      const uid = params.userId;
      const isDocumentId = typeof uid === 'string' && uid.length > 10 && !/^\d+$/.test(uid);
      filters.submitted_by = isDocumentId ? { documentId: uid } : { id: uid };
    }
    if (params.dateFrom || params.dateTo) {
      filters.submitted_at = {};
      if (params.dateFrom) filters.submitted_at.$gte = params.dateFrom;
      if (params.dateTo) filters.submitted_at.$lte = params.dateTo;
    }

    let submissions = [];
    try {
      submissions = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        filters,
        status: 'published',
        populate: ['quiz'],
        limit: 5000,
        start: 0,
      });
      if (!Array.isArray(submissions)) submissions = [];
    } catch (e) {
      strapi.log.error('Quiz global: quiz-submission findMany failed:', e?.message || e);
      return { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 };
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
    const filters = {};

    if (params.dateFrom || params.dateTo) {
      filters.publishedAt = {};
      if (params.dateFrom) filters.publishedAt.$gte = params.dateFrom;
      if (params.dateTo) filters.publishedAt.$lte = params.dateTo;
    }

    if (params.company) filters.company = { name: params.company };

    // Count users (all non-blocked)
    const totalUsersWhere = { blocked: { $eq: false } };
    if (params.company) totalUsersWhere.company = params.company;
    const totalUsers = await strapi.db.query('plugin::users-permissions.user').count({
      where: totalUsersWhere,
    });

    // Count active users (non-blocked + active); user schema uses "active" not "is_active"
    const activeUsersCountWhere = { blocked: { $eq: false }, active: { $eq: true } };
    if (params.company) activeUsersCountWhere.company = params.company;
    const totalActiveUsers = await strapi.db.query('plugin::users-permissions.user').count({
      where: activeUsersCountWhere,
    });

    // Active users by company (for company-wise breakdown)
    const activeUsersWhere = { blocked: { $eq: false }, active: { $eq: true } };
    if (params.company) activeUsersWhere.company = params.company;
    const activeUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: activeUsersWhere,
      select: ['company'],
    });
    const activeUsersByCompany = {};
    activeUsers.forEach((u) => {
      const company = u.company || 'Unassigned';
      activeUsersByCompany[company] = (activeUsersByCompany[company] || 0) + 1;
    });

    // Holidays - by month (holiday has unit_location; news/event do not)
    const holidayFilters = { ...filters };
    if (params.unitLocation) holidayFilters.unit_location = { id: params.unitLocation };
    const holidays = await strapi.documents('api::holiday.holiday').findMany({
      filters: holidayFilters,
      status: 'published',
      pagination: { limit: 1000 },
    });
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

    // Employees by company (all non-blocked)
    const employeesWhere = { blocked: { $eq: false } };
    if (params.company) employeesWhere.company = params.company;
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: employeesWhere,
      select: ['company'],
    });
    const employeesByCompany = {};
    users.forEach((u) => {
      const company = u.company || 'Unassigned';
      employeesByCompany[company] = (employeesByCompany[company] || 0) + 1;
    });

    // News
    const newsItems = await strapi.documents('api::news.news').findMany({
      filters,
      status: 'published',
      populate: ['news_category'],
      pagination: { limit: 1000 },
    });
    const newsByCategory = {};
    newsItems.forEach((n) => {
      const cat = n.news_category?.name || 'Uncategorized';
      newsByCategory[cat] = (newsByCategory[cat] || 0) + 1;
    });

    // Events
    const events = await strapi.documents('api::event.event').findMany({
      filters,
      status: 'published',
      pagination: { limit: 500 },
    });
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
    const townhalls = await strapi.documents('api::townhall.townhall').findMany({
      filters: townhallFilters,
      status: 'published',
      pagination: { limit: 500 },
    });
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
  },

  /**
   * OVERALL ANALYTICS - Personal
   */
  async getOverallPersonal(userId, params = {}) {
    if (!userId) return null;

    const filters = {};
    if (params.dateFrom || params.dateTo) {
      filters.publishedAt = {};
      if (params.dateFrom) filters.publishedAt.$gte = params.dateFrom;
      if (params.dateTo) filters.publishedAt.$lte = params.dateTo;
    }
    if (params.company) filters.company = { name: params.company };

    const holidays = await strapi.documents('api::holiday.holiday').findMany({
      filters,
      status: 'published',
      pagination: { limit: 500 },
    });

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
    const targetUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId, blocked: { $eq: false } },
      select: ['company'],
    });
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
    const result = await this.getLearningEmployeeTableForExport(params);
    const headers = [
      'Employee Name',
      'Company',
      'Courses Enrolled',
      'Total Modules Done',
      'Progress %',
      'Avg Quiz Score',
      'Course Completion Time (min)',
    ];
    const headerRow = headers.map((h) => this.escapeCsvValue(h)).join(',');
    const dataRows = (result.rows || []).map((r) =>
      [
        r.employeeName,
        r.company,
        r.coursesEnrolled,
        r.totalModulesDone,
        r.progressPercent,
        r.avgScore,
        r.courseCompletionTimeMinutes,
      ]
        .map((v) => this.escapeCsvValue(v))
        .join(',')
    );
    const csv = [headerRow, ...dataRows].join('\r\n');
    return '\uFEFF' + csv; // BOM for Excel UTF-8
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
   * Get employee list for filter dropdown
   */
  async getEmployeesList(params = {}) {
    const where = { blocked: { $eq: false } };
    if (params.company) where.company = params.company;
    if (params.department) where.department = { id: params.department };

    // Search by ID or email (for personal view) (for personal view)
    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      if (!Number.isNaN(numericId) && String(numericId) === search) {
        where.id = numericId;
      } else {
        where.email = { $containsi: search };
      }
    }

    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where,
      populate: ['department', 'designation'],
      orderBy: { employee_name: 'asc' },
      limit: params.search ? 1 : 500,
    });

    return users.map((u) => ({
      id: u.id,
      employee_name: u.employee_name || u.username || u.email,
      email: u.email,
      department: u.department?.name,
      designation: u.designation?.title,
      company: u.company,
    }));
  },

  /**
   * Get department list for filter dropdown
   */
  async getDepartmentsList() {
    const departments = await strapi.documents('api::department.department').findMany({
      sort: [{ name: 'asc' }],
      pagination: { limit: 200 },
    });
    return departments.map((d) => ({ id: d.id, name: d.name }));
  },

  /**
   * Get unit location list for filter dropdown (Overall dashboard)
   */
  async getUnitLocationsList() {
    const locations = await strapi.documents('api::unit-location.unit-location').findMany({
      sort: [{ name: 'asc' }],
      pagination: { limit: 200 },
    });
    return locations.map((l) => ({ id: l.id, name: l.name }));
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
      const mins = Math.round((log.duration_seconds || 0) / 60);
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
      const secs = log.duration_seconds || 0;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      const duration = m > 0 ? `${m}m ${s}s` : `${s}s`;
      const userName = log.user
        ? (log.user.employee_name || log.user.username || log.user.email || `User ${log.user.id}`)
        : '—';
      const companyName = log.company?.name ?? log.user?.company ?? '—';
      return {
        userName,
        company: companyName,
        activity: log.activity_description || log.activity_type || '—',
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
        companyId = parseInt(company, 10);
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
        duration_seconds: Math.max(0, duration_seconds || 0),
        timestamp: new Date().toISOString(),
      },
    });
    return entry;
  },
});
