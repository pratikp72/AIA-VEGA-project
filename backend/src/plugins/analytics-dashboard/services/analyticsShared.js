'use strict';

/**
 * Analytics Shared Service
 * Used by both Learning and Overall dashboards: employees, departments, unit-locations, activity.
 */
module.exports = ({ strapi }) => {
  const self = {};

  self.resolveCompanyId = async function (company) {
    if (company == null || company === '') return null;
    const str = String(company).trim();
    const numeric = typeof company === 'number' ? company : parseInt(str, 10);
    if (!Number.isNaN(numeric)) return numeric;
    try {
      const found = await strapi.db.query('api::company.company').findOne({
        where: { name: str },
        select: ['id'],
      });
      if (found?.id != null) return found.id;
      const all = await strapi.db.query('api::company.company').findMany({
        select: ['id', 'name'],
        limit: 50,
      });
      const lower = str.toLowerCase();
      const match = (all || []).find(
        (c) => c.name && (String(c.name).toLowerCase() === lower || String(c.name).toLowerCase().includes(lower))
      );
      return match?.id ?? null;
    } catch (e) {
      return null;
    }
  };

  self._dedupeById = function (list) {
    const seenId = new Set();
    const seenName = new Set();
    return (list || []).filter((item) => {
      const key = item.id != null ? String(item.id) : (item.documentId != null ? String(item.documentId) : null);
      const nameKey = (item.name != null ? String(item.name).trim().toLowerCase() : '') || `__${key}`;
      if (key == null || seenId.has(key) || seenName.has(nameKey)) return false;
      seenId.add(key);
      seenName.add(nameKey);
      return true;
    });
  };

  self.getEmployeesList = async function (params = {}) {
    const where = { blocked: { $eq: false } };
    const companyVal = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    if (companyVal) {
      const c = String(params.company).trim();
      where.company = c === 'vega' ? 'Vega' : c === 'aia' ? 'AIA' : c;
    }
    const deptVal = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    if (deptVal) {
      const deptId = params.department;
      const isNumeric = typeof deptId === 'number' || /^\d+$/.test(String(deptId));
      if (isNumeric) {
        try {
          const deptRow = await strapi.db.query('api::department.department').findOne({
            where: { id: Number(deptId) },
            select: ['name'],
          });
          if (deptRow?.name) where.department = deptRow.name;
        } catch (e) {
          strapi.log.warn('getEmployeesList: resolve department failed', e?.message);
        }
      } else {
        where.department = { $containsi: String(deptId) };
      }
    }
    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      const isNumericSearch = !Number.isNaN(numericId) && String(numericId) === search;
      if (isNumericSearch) {
        where.$or = [{ id: numericId }, { emp_code: search }, { emp_id: search }];
      } else {
        where.$or = [
          { email: { $containsi: search } },
          { employee_name: { $containsi: search } },
          { username: { $containsi: search } },
          { emp_code: { $containsi: search } },
          { emp_id: { $containsi: search } },
        ];
      }
    }
    try {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where,
        orderBy: { employee_name: 'ASC' },
        limit: params.search ? 100 : 500,
      });
      const list = Array.isArray(users) ? users : [];
      return list.map((u) => ({
        id: u.id,
        documentId: u.documentId ?? u.document_id ?? null,
        employee_name: u.employee_name || u.username || u.email || '—',
        username: u.username ?? '—',
        email: u.email || '—',
        emp_code: u.emp_code ?? '—',
        emp_id: u.emp_id ?? '—',
        department: typeof u.department === 'object' && u.department?.name != null ? u.department.name : (u.department ?? '—'),
        designation: typeof u.designation === 'string' ? u.designation : (u.designation?.title ?? '—'),
        company: u.company ?? '—',
      }));
    } catch (e) {
      strapi.log.error('getEmployeesList error:', e?.message || e);
      return [];
    }
  };

  self.getDepartmentsList = async function (company) {
    try {
      const companyId = await self.resolveCompanyId(company);
      const where = companyId != null ? { company: companyId } : {};
      const departments = await strapi.db.query('api::department.department').findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { name: 'asc' },
        limit: 200,
      });
      const list = Array.isArray(departments) ? departments : [];
      const mapped = list.map((d) => ({ id: d.id ?? d.documentId, documentId: d.documentId, name: d.name }));
      return self._dedupeById(mapped);
    } catch (e) {
      strapi.log.error('getDepartmentsList error:', e?.message || e);
      return [];
    }
  };

  self.getUnitLocationsList = async function (company) {
    // Now fetch from work-location instead of unit-location
    try {
      const companyId = await self.resolveCompanyId(company);
      const where = companyId != null ? { company: { id: companyId } } : {};
      const locations = await strapi.db.query('api::work-location.work-location').findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { name: 'asc' },
        limit: 200,
      });
      const list = Array.isArray(locations) ? locations : [];
      const mapped = list.map((l) => ({ id: l.id ?? l.documentId, documentId: l.documentId, name: l.name }));
      return self._dedupeById(mapped);
    } catch (e) {
      strapi.log.error('getUnitLocationsList error:', e?.message || e);
      return [];
    }
  };

  self.getActivityTimeByTypeAndDay = async function (params = {}) {
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
      if (allowedUserIds.length === 0) return [];
      where.user = { id: { $in: allowedUserIds } };
    } else if (params.company || params.department) {
      where.user = where.user || {};
      if (params.company) where.user.company = params.company;
      if (params.department) where.user.department = { id: params.department };
    }
    if (params.activityType) where.activity_type = params.activityType;

    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 10000,
    });
    const list = Array.isArray(logs) ? logs : [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDate = {};
    const pageTypes = ['News', 'Event', 'Location', 'Routes', 'People', 'Gallery', 'Home'];
    list.forEach((log) => {
      if (!log.timestamp) return;
      const d = new Date(log.timestamp);
      const dateKey = log.timestamp.slice(0, 10);
      const dayKey = dayNames[d.getDay()];
      if (!byDate[dateKey]) {
        const initial = { date: dateKey, day: dayKey };
        pageTypes.forEach((t) => { initial[t] = 0; });
        byDate[dateKey] = initial;
      }
      const type = log.activity_type || 'News';
      const mins = log.activity_duration || 0;
      if (byDate[dateKey][type] !== undefined) {
        byDate[dateKey][type] += mins;
      } else {
        byDate[dateKey][type] = mins;
      }
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  };

  /** Normalize date param to ISO string; if date-only or start-of-day, extend to start/end of day for timestamp range. */
  function normalizeDateBound(value, endOfDay) {
    if (value == null || value === '') return null;
    const str = typeof value === 'string' ? value.trim() : (value instanceof Date ? value.toISOString() : String(value));
    if (!str) return null;
    const dateOnly = str.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      return endOfDay ? `${dateOnly}T23:59:59.999Z` : `${dateOnly}T00:00:00.000Z`;
    }
    return str;
  }

  /** Activity types to exclude from Overall Analytics (Course, Quiz, Feedback). */
  const EXCLUDED_ACTIVITY_TYPES = ['Course', 'Quiz', 'Feedback'];

  /** Build shared where for activity log queries (date, company, department, unitLocation, activityType, userId). Uses relation "user" and activity_log.company so filters work with Strapi 5. Excludes Course, Quiz, Feedback from all activity data. */
  self._buildActivityWhere = async function (params = {}) {
    const where = {};
    where.activity_type = { $notIn: EXCLUDED_ACTIVITY_TYPES };

    if (params.dateFrom || params.dateTo) {
      const from = normalizeDateBound(params.dateFrom, false);
      const to = normalizeDateBound(params.dateTo, true);
      if (from || to) {
        where.timestamp = {};
        if (from) where.timestamp.$gte = from;
        if (to) where.timestamp.$lte = to;
      }
    }
    if (params.activityType) where.activity_type = params.activityType;

    if (params.userId != null && params.userId !== '') {
      let numericId = null;
      if (typeof params.userId === 'number' && !Number.isNaN(params.userId)) {
        numericId = params.userId;
      } else {
        const str = String(params.userId).trim();
        const parsed = parseInt(str, 10);
        if (!Number.isNaN(parsed) && String(parsed) === str) {
          numericId = parsed;
        } else {
          const u = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { documentId: str },
            select: ['id'],
          });
          numericId = u?.id ?? null;
        }
      }
      if (numericId == null) return null;
      where.user = { id: numericId };
      return where;
    }

    const companyVal = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    if (params.unitLocation || params.department || companyVal) {
      const userWhere = { blocked: { $ne: true } };
      if (companyVal) {
        const c = String(params.company).trim().toLowerCase();
        userWhere.company = c === 'vega' ? 'Vega' : c === 'aia' ? 'AIA' : String(params.company).trim();
      }

      if (params.department) {
        try {
          const deptId = params.department;
          const isNumeric = typeof deptId === 'number' || /^\d+$/.test(String(deptId));
          const deptRow = isNumeric
            ? await strapi.db.query('api::department.department').findOne({
                where: { id: Number(deptId) },
                select: ['name'],
              })
            : await strapi.db.query('api::department.department').findOne({
                where: { documentId: String(deptId) },
                select: ['name'],
              });
          if (deptRow?.name) userWhere.department = { $eqi: deptRow.name };
        } catch (e) {
          strapi.log.warn('_buildActivityWhere: resolve department failed', e?.message);
        }
      }

      if (params.unitLocation) {
        try {
          const locId = params.unitLocation;
          const isNumeric = typeof locId === 'number' || /^\d+$/.test(String(locId));
          const locRow = isNumeric
            ? await strapi.db.query('api::work-location.work-location').findOne({
                where: { id: Number(locId) },
                select: ['name'],
              })
            : await strapi.db.query('api::work-location.work-location').findOne({
                where: { documentId: String(locId) },
                select: ['name'],
              });
          if (locRow?.name) userWhere.working_location = { $containsi: locRow.name };
        } catch (e) {
          strapi.log.warn('_buildActivityWhere: resolve work location failed', e?.message);
        }
      }

      const usersMatch = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: userWhere,
        select: ['id'],
      });
      const allowedUserIds = (usersMatch || []).map((u) => u.id).filter((id) => id != null);
      if (allowedUserIds.length === 0) return null;
      where.user = { id: { $in: allowedUserIds } };
    }

    return where;
  };

  /**
   * Activity Tracking KPIs: totalUser (visit count), uniqueUser, timeSpentMin, avgTimeSpentMin.
   * totalUser = count of every page visit (same user visiting 3 times = 3).
   * uniqueUser = distinct users who visited.
   */
  self.getActivityTrackingKpis = async function (params = {}) {
    const where = await self._buildActivityWhere(params);
    if (where === null) {
      return { totalUser: 0, uniqueUser: 0, timeSpentMin: 0, avgTimeSpentMin: 0 };
    }
    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 50000,
      select: ['activity_duration'],
      populate: { user: { select: ['id'] } },
    });
    const list = Array.isArray(logs) ? logs : [];
    const totalUser = list.length;
    const getUserId = (l) => l.user_id ?? l.users_permissions_user_id ?? (typeof l.user === 'object' && l.user != null ? l.user.id : l.user);
    const uniqueUserIds = new Set(list.map(getUserId).filter(Boolean));
    const uniqueUser = uniqueUserIds.size;
    const timeSpentMin = list.reduce((sum, l) => sum + (Number(l.activity_duration) || 0), 0);
    const avgTimeSpentMin = uniqueUser > 0 ? Math.round((timeSpentMin / uniqueUser) * 10) / 10 : 0;
    return { totalUser, uniqueUser, timeSpentMin, avgTimeSpentMin };
  };

  const ACTIVITY_PAGES = ['News', 'Event', 'Location', 'Routes', 'People', 'Gallery', 'Home', 'Company policy', 'Form & Templates', 'Calendar'];

  /**
   * Top pages by time (desc) and least used pages by time (asc) for Activity Tracking charts.
   * Bar length = total time (minutes). Tooltip shows visit count.
   * Returns { topPagesByVisit: [{ name, value (min), count }], leastUsedPages: [{ name, value (min), count }] }.
   */
  self.getActivityPagesStats = async function (params = {}) {
    const where = await self._buildActivityWhere(params);
    if (where === null) {
      return { topPagesByVisit: [], leastUsedPages: [] };
    }
    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 50000,
      select: ['activity_type', 'activity_duration'],
    });
    const list = Array.isArray(logs) ? logs : [];
    const byType = {};
    list.forEach((log) => {
      const t = log.activity_type || 'News';
      if (!byType[t]) byType[t] = { count: 0, timeMin: 0 };
      byType[t].count += 1;
      byType[t].timeMin += Number(log.activity_duration) || 0;
    });
    const withTimeAndCount = ACTIVITY_PAGES.map((type) => ({
      name: type,
      value: byType[type] ? Math.round(byType[type].timeMin * 10) / 10 : 0,
      count: byType[type] ? byType[type].count : 0,
    }));
    const topPagesByVisit = [...withTimeAndCount].sort((a, b) => b.value - a.value).map(({ name, value, count }) => ({ name, value, count }));
    const leastUsedPages = [...withTimeAndCount].sort((a, b) => a.value - b.value).map(({ name, value, count }) => ({ name, value, count }));
    return { topPagesByVisit, leastUsedPages };
  };

  /** Allowed sort fields for activity log: activity_type, activity_duration, timestamp. */
  const ACTIVITY_LOG_SORT_FIELDS = ['activity_type', 'activity_duration', 'timestamp'];

  self.getActivityLog = async function (params = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(params.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;
    const where = await self._buildActivityWhere(params);
    if (where === null) return { rows: [], total: 0, page, pageSize };

    const sortByParam = params.sortBy && String(params.sortBy).trim();
    const sortOrderParam = (params.sortOrder && String(params.sortOrder).toLowerCase()) === 'asc' ? 'asc' : 'desc';
    const sortField =
      sortByParam === 'activity'
        ? 'activity_type'
        : sortByParam === 'duration'
          ? 'activity_duration'
          : sortByParam === 'timestamp' || sortByParam === 'date'
            ? 'timestamp'
            : 'timestamp';
    const orderByField = ACTIVITY_LOG_SORT_FIELDS.includes(sortField) ? sortField : 'timestamp';
    const orderBy = { [orderByField]: sortOrderParam };

    const total = await strapi.db.query('api::activity-log.activity-log').count({ where });
    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: pageSize,
      offset,
      orderBy,
      populate: ['user', 'company'],
    });
    const list = Array.isArray(logs) ? logs : [];
    const rows = list.map((log) => {
      const mins = log.activity_duration || 0;
      const secs = mins * 60;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      let duration;
      if (mins === 0) duration = 0;
      else if (s === 0) duration = `${m}m`;
      else duration = `${m}m ${s}s`;
      const userName = log.user ? (log.user.employee_name || log.user.username || log.user.email || `User ${log.user.id}`) : '—';
      const companyName = log.company?.name ?? log.user?.company ?? '—';
      return { userName, company: companyName, activity: log.activity_type || log.activity_description || '—', duration, timestamp: log.timestamp };
    });
    return { rows, total, page, pageSize };
  };

  self.createActivityLog = async function (data) {
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
  };

  return self;
};
