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
  const relationsController = plugin.controllers.relations;
  const defaultFindAvailable = relationsController.findAvailable.bind(relationsController);

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
      return defaultFindAvailable(ctx);
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
      return await defaultFindAvailable(ctx);
    } finally {
      strapi.db.query = originalQuery;
    }
  };

  return plugin;
};
