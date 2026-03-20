'use strict';

const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const COURSE_WORKFLOW_UID = 'api::course-workflow.course-workflow';
const WORKFLOW_MODULE_COMPONENT_UID = 'course.workflow-module';
const COURSE_UID = 'api::course.course';
const DEPARTMENT_UID = 'api::department.department';
const WORK_LOCATION_UID = 'api::work-location.work-location';
const USER_UID = 'plugin::users-permissions.user';
const COMPANY_UID = 'api::company.company';
const EVENT_UID = 'api::event.event';
const HOLIDAY_UID = 'api::holiday.holiday';

function mergeWithAnd(existing, filter) {
  if (!existing || Object.keys(existing).length === 0) return filter;
  if (existing.$and && Array.isArray(existing.$and)) {
    return { ...existing, $and: [...existing.$and, filter] };
  }
  return { $and: [existing, filter] };
}

function normalizeCompanyName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (lower === 'aia' || lower.includes('aia')) return 'AIA';
  if (lower === 'vega' || lower.includes('vega')) return 'Vega';
  return String(name || '').trim();
}

function getSearchableFields(targetUid, targetModel) {
  const attrs = targetModel?.attributes || {};
  const attrNames = Object.keys(attrs);
  const fieldSet = new Set();

  const tryAdd = (field) => {
    if (!field || !attrs[field]) return;
    const type = attrs[field].type;
    if (['string', 'text', 'email', 'uid'].includes(type)) {
      fieldSet.add(field);
    }
  };

  tryAdd(targetModel?.info?.mainField);

  if (targetUid === COURSE_UID) {
    tryAdd('title');
  }

  if (targetUid === USER_UID) {
    ['username', 'email', 'emp_code', 'emp_id', 'designation', 'department'].forEach(tryAdd);
  }

  ['name', 'title', 'username', 'email'].forEach(tryAdd);

  if (fieldSet.size === 0) {
    attrNames.forEach((field) => tryAdd(field));
  }

  return [...fieldSet];
}

function getSortField(targetUid, targetModel) {
  const attrs = targetModel?.attributes || {};
  const preferred = [];

  if (targetModel?.info?.mainField) preferred.push(targetModel.info.mainField);
  if (targetUid === COURSE_UID) preferred.push('title');
  preferred.push('name', 'username', 'email', 'documentId', 'id');

  for (const field of preferred) {
    if (field === 'id') return 'id';
    if (attrs[field]) return field;
  }

  return 'id';
}

function parseRawCompanyIds(rawCompanyId) {
  if (rawCompanyId == null) return [];

  const values = Array.isArray(rawCompanyId)
    ? rawCompanyId
    : String(rawCompanyId)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

  const uniq = [];
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (!uniq.includes(normalized)) uniq.push(normalized);
  });

  return uniq;
}

function getExcludeCourseFilter(rawExcludeCourseIds) {
  const ids = parseRawCompanyIds(rawExcludeCourseIds);
  if (ids.length === 0) return null;

  const numericIds = [];
  const docIds = [];

  ids.forEach((raw) => {
    const numId = parseInt(raw, 10);
    const isDocId = Number.isNaN(numId) || raw.length > 10;
    if (isDocId) docIds.push(raw);
    else numericIds.push(numId);
  });

  const clauses = [];
  if (numericIds.length > 0) clauses.push({ id: { $notIn: numericIds } });
  if (docIds.length > 0) clauses.push({ documentId: { $notIn: docIds } });

  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function mergeFilterIfPresent(baseFilter, nextFilter) {
  if (!nextFilter || typeof nextFilter !== 'object') return baseFilter;
  if (!baseFilter || typeof baseFilter !== 'object') return nextFilter;
  return mergeWithAnd(baseFilter, nextFilter);
}

async function getCompanyNamesFromRawId(strapi, rawCompanyId) {
  const ids = parseRawCompanyIds(rawCompanyId);
  if (ids.length === 0) return [];

  const numericIds = [];
  const docIds = [];

  ids.forEach((raw) => {
    const numId = parseInt(raw, 10);
    const isDocId = Number.isNaN(numId) || raw.length > 10;
    if (isDocId) docIds.push(raw);
    else numericIds.push(numId);
  });

  const companyWhere = [];
  if (numericIds.length > 0) {
    companyWhere.push({ id: { $in: numericIds } });
  }
  if (docIds.length > 0) {
    companyWhere.push({ documentId: { $in: docIds } });
  }
  if (companyWhere.length === 0) return [];

  const companies = await strapi.db.query(COMPANY_UID).findMany({
    where: companyWhere.length === 1 ? companyWhere[0] : { $or: companyWhere },
    select: ['name'],
    limit: Math.max(5, ids.length * 3),
  });

  return [...new Set((companies || []).map((c) => normalizeCompanyName(c?.name)).filter(Boolean))];
}

async function getCompanyFilterForDepartment(strapi, sourceUid, documentId) {
  const sourceSchema = strapi.getModel(sourceUid);
  if (!sourceSchema || !sourceSchema.attributes?.company) {
    return null;
  }
  const companyAttr = sourceSchema.attributes.company;
  if (companyAttr.type !== 'relation' || companyAttr.target !== COMPANY_UID) {
    return null;
  }

  const doc = await strapi.db.query(sourceUid).findOne({
    where: { documentId },
    populate: { company: true },
  });
  if (!doc) return null;

  const company = doc.company;
  const documentIds = [];
  if (Array.isArray(company)) {
    company.forEach((c) => {
      if (c && c.documentId != null) documentIds.push(c.documentId);
    });
  } else if (company && company.documentId != null) {
    documentIds.push(company.documentId);
  }

  if (documentIds.length === 0) return null;
  return documentIds.length === 1
    ? { documentId: documentIds[0] }
    : { documentId: { $in: documentIds } };
}

async function getCompanyScopedFilter(strapi, targetUid, rawCompanyId) {
  const ids = parseRawCompanyIds(rawCompanyId);
  if (ids.length === 0) return null;

  const numericIds = [];
  const docIds = [];

  ids.forEach((raw) => {
    const numId = parseInt(raw, 10);
    const isDocId = Number.isNaN(numId) || raw.length > 10;
    if (isDocId) docIds.push(raw);
    else numericIds.push(numId);
  });

  const companyClauses = [];
  if (numericIds.length === 1) companyClauses.push({ company: { id: numericIds[0] } });
  else if (numericIds.length > 1) companyClauses.push({ company: { id: { $in: numericIds } } });

  if (docIds.length === 1) companyClauses.push({ company: { documentId: docIds[0] } });
  else if (docIds.length > 1) companyClauses.push({ company: { documentId: { $in: docIds } } });

  if (targetUid === COURSE_UID || targetUid === DEPARTMENT_UID || targetUid === WORK_LOCATION_UID) {
    if (companyClauses.length === 0) return null;
    return companyClauses.length === 1 ? companyClauses[0] : { $or: companyClauses };
  }

  if (targetUid === USER_UID) {
    const companyNames = await getCompanyNamesFromRawId(strapi, ids);
    if (companyNames.length === 0) return { id: { $eq: -1 } };
    if (companyNames.length === 1) {
      return { company: companyNames[0] };
    }
    return {
      $or: companyNames.map((name) => ({ company: name })),
    };
  }

  return null;
}

module.exports = (plugin) => {
  plugin.controllers.coursesForCompany = {
    async find(ctx) {
      const companyId = ctx.query?.companyId;
      if (!companyId) return ctx.badRequest('companyId query param is required');

      const filter = await getCompanyScopedFilter(strapi, COURSE_UID, companyId);
      if (!filter) {
        ctx.body = { results: [] };
        return;
      }

      try {
        const courses = await strapi.db.query(COURSE_UID).findMany({
          where: filter,
          select: ['id', 'documentId', 'title'],
          orderBy: { title: 'asc' },
          limit: 300,
        });
        ctx.body = { results: courses };
      } catch (err) {
        strapi.log.error('[courses-for-company]', err?.message || err);
        ctx.body = { results: [] };
      }
    },
  };

  if (Array.isArray(plugin.routes?.admin?.routes)) {
    plugin.routes.admin.routes.push({
      method: 'GET',
      path: '/courses-for-company',
      handler: 'coursesForCompany.find',
      config: { policies: [] },
    });
  }

  const relationsController = plugin.controllers.relations;
  const defaultFindAvailable = relationsController.findAvailable.bind(relationsController);

  async function findAvailableFallback(ctx, targetUid, extraFilter = null) {
    const { _q = '', pageSize = 10, _limit, page = 1, _page } = ctx.request?.query ?? {};
    const requestedLimit = pageSize ?? _limit ?? 10;
    const requestedPage = page ?? _page ?? 1;
    const limit = Math.max(1, parseInt(String(requestedLimit), 10) || 10);
    const currentPage = Math.max(1, parseInt(String(requestedPage), 10) || 1);
    const offset = (currentPage - 1) * limit;

    const targetModel = strapi.getModel(targetUid);
    const sortField = getSortField(targetUid, targetModel);
    const searchableFields = getSearchableFields(targetUid, targetModel);
    const searchTerm = String(_q || '').trim();
    let where = {};

    if (searchTerm) {
      where = {
        $or: searchableFields.map((field) => ({ [field]: { $containsi: searchTerm } })),
      };
    }

    if (extraFilter && typeof extraFilter === 'object') {
      where = mergeWithAnd(where, extraFilter);
    }

    const [results, total] = await Promise.all([
      strapi.db.query(targetUid).findMany({ where, limit, offset, orderBy: { [sortField]: 'asc' } }),
      strapi.db.query(targetUid).count({ where }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / limit));

    ctx.body = {
      results,
      pagination: {
        page: currentPage,
        pageSize: limit,
        total,
        pageCount,
      },
    };
  }

  const runFindAvailableSafely = async (ctx, targetUid) => {
    try {
      return await defaultFindAvailable(ctx);
    } catch (err) {
      const msg = String(err?.message || '');
      const isLocaleBug =
        msg.includes("Cannot destructure property 'locale'") &&
        String(err?.stack || '').includes('content-manager') &&
        String(err?.stack || '').includes('relations.js');

      if (isLocaleBug && targetUid) {
        strapi.log.warn(`[content-manager ext] findAvailable locale-bug for ${targetUid}; using direct-DB fallback`);
        return findAvailableFallback(ctx, targetUid);
      }

      if (isLocaleBug) {
        strapi.log.warn('content-manager relations.findAvailable failed due to permission-denied destructure path; returning 403');
        return ctx.forbidden('You do not have permission to read this relation.');
      }

      throw err;
    }
  };

  relationsController.findAvailable = async function findAvailable(ctx) {
    const { model: sourceUid, targetField } = ctx.params;
    const id = ctx.request?.query?.id;
    const selectedCompanyId = ctx.request?.query?.companyId;
    const excludeCourseIds = ctx.request?.query?.excludeCourseIds;
    const sourceModel = sourceUid ? strapi.getModel(sourceUid) : null;
    const targetSchema = sourceModel?.attributes?.[targetField];
    let targetUid = targetSchema?.target;

    // Component relation fallback for workflow modules (e.g. targetField like "modules.course")
    if (!targetUid && sourceUid === COURSE_WORKFLOW_UID && typeof targetField === 'string') {
      if (targetField === 'users_permissions_users') targetUid = USER_UID;
      else if (targetField === 'course' || targetField.endsWith('.course') || targetField.includes('course')) targetUid = COURSE_UID;
    }

    // Handle component UID directly (course.workflow-module/course)
    if (!targetUid && sourceUid === WORKFLOW_MODULE_COMPONENT_UID && targetField === 'course') {
      targetUid = COURSE_UID;
    }

    const isWorkflowSource =
      sourceUid === COURSE_ASSIGNMENT_UID ||
      sourceUid === COURSE_WORKFLOW_UID ||
      sourceUid === WORKFLOW_MODULE_COMPONENT_UID ||
      sourceUid === EVENT_UID ||
      sourceUid === HOLIDAY_UID;

    if (isWorkflowSource && selectedCompanyId && targetUid) {
      const companyFilter = await getCompanyScopedFilter(strapi, targetUid, selectedCompanyId);
      if (companyFilter) {
        ctx.state._relationCompanyFilter = { uid: targetUid, filter: companyFilter };
      }
    }

    if (targetUid === DEPARTMENT_UID && id && sourceUid) {
      const companyFilter = await getCompanyFilterForDepartment(strapi, sourceUid, id);
      if (companyFilter) {
        ctx.state._departmentCompanyFilter = { uid: DEPARTMENT_UID, filter: { company: companyFilter } };
      }
    }

    if (
      (sourceUid === COURSE_WORKFLOW_UID || sourceUid === WORKFLOW_MODULE_COMPONENT_UID) &&
      targetUid === COURSE_UID &&
      excludeCourseIds
    ) {
      const excludeFilter = getExcludeCourseFilter(excludeCourseIds);
      if (excludeFilter) {
        ctx.state._workflowCourseExcludeFilter = { uid: COURSE_UID, filter: excludeFilter };
      }
    }

    let scopedRelationFilter = null;
    scopedRelationFilter = mergeFilterIfPresent(scopedRelationFilter, ctx.state._relationCompanyFilter?.filter);
    scopedRelationFilter = mergeFilterIfPresent(scopedRelationFilter, ctx.state._departmentCompanyFilter?.filter);
    scopedRelationFilter = mergeFilterIfPresent(scopedRelationFilter, ctx.state._workflowCourseExcludeFilter?.filter);

    if (!scopedRelationFilter) {
      return runFindAvailableSafely(ctx, targetUid);
    }
    return findAvailableFallback(ctx, targetUid, scopedRelationFilter);
  };

  return plugin;
};
