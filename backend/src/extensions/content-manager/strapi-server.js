'use strict';

const DEPARTMENT_UID = 'api::department.department';

/**
 * Get company documentIds from the current source document for filtering
 * department relation options. Handles manyToOne and manyToMany company.
 */
async function getCompanyFilterForDepartment(strapi, sourceUid, documentId) {
  const sourceSchema = strapi.getModel(sourceUid);
  if (!sourceSchema || !sourceSchema.attributes?.company) {
    return null;
  }
  const companyAttr = sourceSchema.attributes.company;
  if (companyAttr.type !== 'relation' || companyAttr.target !== 'api::company.company') {
    return null;
  }
  const isMany = companyAttr.relation && companyAttr.relation.toLowerCase().includes('many');
  const populate = isMany ? { company: true } : { company: true };

  const doc = await strapi.db.query(sourceUid).findOne({
    where: { documentId },
    populate,
  });
  if (!doc) return null;

  const company = doc.company;
  const documentIds = [];
  if (Array.isArray(company)) {
    company.forEach((c) => {
      if (c && (c.documentId != null)) documentIds.push(c.documentId);
    });
  } else if (company && company.documentId != null) {
    documentIds.push(company.documentId);
  }
  if (documentIds.length === 0) return null;
  return documentIds.length === 1
    ? { documentId: documentIds[0] }
    : { documentId: { $in: documentIds } };
}

/**
 * Extend content-manager so the "find available relations" for department
 * only returns departments that belong to the current record's company.
 */
module.exports = (plugin) => {
  // ── Admin helper: courses that belong to a specific company ───────────────
  plugin.controllers['coursesForCompany'] = {
    async find(ctx) {
      const companyId = ctx.query?.companyId;
      if (!companyId) return ctx.badRequest('companyId query param is required');

      const numId    = parseInt(String(companyId), 10);
      const isDocId  = isNaN(numId) || String(companyId).length > 10;

      try {
        const courses = await strapi.db.query('api::course.course').findMany({
          where: isDocId
            ? { company: { documentId: companyId } }
            : { company: { id: numId } },
          select: ['id', 'documentId', 'title'],
          orderBy:  { title: 'asc' },
          limit:    300,
        });
        ctx.body = { results: courses };
      } catch (err) {
        strapi.log.error('[courses-for-company]', err?.message);
        ctx.body = { results: [] };
      }
    },
  };

  if (Array.isArray(plugin.routes?.['admin']?.routes)) {
    plugin.routes['admin'].routes.push({
      method: 'GET',
      path:   '/courses-for-company',
      handler: 'coursesForCompany.find',
      config:  { policies: [] },
    });
  }

  const relationsController = plugin.controllers.relations;
  const defaultFindAvailable = relationsController.findAvailable.bind(relationsController);

  /**
   * Fallback for non-i18n relation targets: Strapi's defaultFindAvailable
   * fails with "Cannot destructure property 'locale'" when the target content
   * type has no i18n/localization support.  Instead of returning 403, we run
   * a direct DB query that mirrors the shape the UI expects.
   */
  async function findAvailableFallback(ctx, targetUid) {
    const { _q = '', pageSize = 10, page = 1 } = ctx.request?.query ?? {};
    const limit  = Math.max(1, parseInt(String(pageSize), 10) || 10);
    const offset = (Math.max(1, parseInt(String(page), 10) || 1) - 1) * limit;

    const targetModel = strapi.getModel(targetUid);
    const mainField   =
      targetModel?.info?.mainField ||
      (targetModel?.attributes?.name ? 'name' : 'id');

    const where = _q ? { [mainField]: { $containsi: String(_q) } } : {};
    // Only published records
    where.publishedAt = { $notNull: true };

    const [results, total] = await Promise.all([
      strapi.db.query(targetUid).findMany({ where, limit, offset, orderBy: { [mainField]: 'asc' } }),
      strapi.db.query(targetUid).count({ where }),
    ]);

    ctx.body = {
      data: {
        results,
        pagination: {
          page:     Math.max(1, parseInt(String(page), 10) || 1),
          pageSize: limit,
          total,
        },
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
        strapi.log.warn(
          `[content-manager ext] findAvailable locale-bug for ${targetUid}; using direct-DB fallback`
        );
        return findAvailableFallback(ctx, targetUid);
      }

      if (isLocaleBug) {
        strapi.log.warn(
          'content-manager relations.findAvailable failed due to permission-denied destructure path; returning 403'
        );
        return ctx.forbidden('You do not have permission to read this relation.');
      }

      throw err;
    }
  };

  relationsController.findAvailable = async function findAvailable(ctx) {
    const { model: sourceUid, targetField } = ctx.params;
    const id = ctx.request?.query?.id;
    const targetSchema = sourceUid && strapi.getModel(sourceUid)?.attributes?.[targetField];
    const targetUid = targetSchema?.target;

    if (targetUid === DEPARTMENT_UID && id && sourceUid) {
      const companyFilter = await getCompanyFilterForDepartment(strapi, sourceUid, id);
      if (companyFilter) {
        ctx.state._departmentCompanyFilter = { company: companyFilter };
      }
    }

    if (!ctx.state._departmentCompanyFilter) {
      return runFindAvailableSafely(ctx, targetUid);
    }

    const originalQuery = strapi.db.query.bind(strapi.db);
    strapi.db.query = function (uid) {
      const query = originalQuery(uid);
      if (uid === DEPARTMENT_UID) {
        const reqCtx = strapi.requestContext?.get?.();
        const filter = reqCtx?.state?._departmentCompanyFilter;
        if (filter) {
          const originalFindPage = query.findPage.bind(query);
          query.findPage = async function (params) {
            params.filters = params.filters || {};
            params.filters.$and = params.filters.$and || [];
            params.filters.$and.push(filter);
            return originalFindPage(params);
          };
        }
      }
      return query;
    };

    try {
      return await runFindAvailableSafely(ctx, targetUid);
    } finally {
      strapi.db.query = originalQuery;
    }
  };

  return plugin;
};
