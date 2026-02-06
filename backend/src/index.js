'use strict';

const USER_UID = 'plugin::users-permissions.user';
const { ensureDepartmentForUser } = require('./utils/ensure-department-for-user');

module.exports = {
  register({ strapi }) {
    strapi.customFields.register({
      name: 'date-future-only',
      type: 'date',
    });
    strapi.customFields.register({
      name: 'number-range',
      type: 'integer',
    });

    // When a user is created or updated, ensure a Department entry exists for their department + company
    strapi.documents.use(async (context, next) => {
      const result = await next();
      if (context.uid !== USER_UID || !['create', 'update'].includes(context.action)) {
        return result;
      }
      // Prefer params.data (payload sent) so we don't depend on result shape
      const fromParams = context.params?.data;
      const fromResult = result?.document ?? result;
      const department = fromParams?.department ?? fromResult?.department;
      const company = fromParams?.company ?? fromResult?.company;
      if (!department || !company) return result;
      try {
        await ensureDepartmentForUser(strapi, department, company);
      } catch (err) {
        strapi.log.warn('ensureDepartmentForUser failed', err);
      }
      return result;
    });
  },

  bootstrap({ strapi }) {
    // Fallback: ensure department when user is created/updated via Content Manager
    const plugin = strapi.plugin('content-manager');
    if (!plugin) return;
    const docManager = plugin.service('document-manager');
    if (!docManager || typeof docManager.create !== 'function') return;

    const originalCreate = docManager.create.bind(docManager);
    docManager.create = async (uid, opts = {}) => {
      const result = await originalCreate(uid, opts);
      if (uid === USER_UID) {
        const department = opts?.data?.department ?? result?.department;
        const company = opts?.data?.company ?? result?.company;
        if (department && company) {
          try {
            await ensureDepartmentForUser(strapi, department, company);
          } catch (err) {
            strapi.log.warn('ensureDepartmentForUser (create) failed', err);
          }
        }
      }
      return result;
    };

    const originalUpdate = docManager.update.bind(docManager);
    docManager.update = async (id, uid, opts = {}) => {
      const result = await originalUpdate(id, uid, opts);
      if (uid === USER_UID) {
        const department = opts?.data?.department ?? result?.department;
        const company = opts?.data?.company ?? result?.company;
        if (department && company) {
          try {
            await ensureDepartmentForUser(strapi, department, company);
          } catch (err) {
            strapi.log.warn('ensureDepartmentForUser (update) failed', err);
          }
        }
      }
      return result;
    };
  },
};
