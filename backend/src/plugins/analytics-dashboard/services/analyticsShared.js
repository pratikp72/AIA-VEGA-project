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
    try {
      const companyId = await self.resolveCompanyId(company);
      const where = companyId != null ? { company: { id: companyId } } : {};
      const locations = await strapi.db.query('api::unit-location.unit-location').findMany({
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
      where.user_id = { $in: allowedUserIds };
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
  };

  self.getActivityLog = async function (params = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(params.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;
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
      if (allowedUserIds.length === 0) return { rows: [], total: 0, page, pageSize };
      where.user_id = { $in: allowedUserIds };
    } else if (params.company || params.department) {
      where.user = where.user || {};
      if (params.company) where.user.company = params.company;
      if (params.department) where.user.department = { id: params.department };
    }
    if (params.activityType) where.activity_type = params.activityType;

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
