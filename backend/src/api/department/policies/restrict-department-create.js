'use strict';

/**
 * Only Super Admin may create Department entries.
 * This policy blocks create via REST API (POST /api/departments).
 * Admin panel creates go through Content Manager; restrict "Create" for Department to Super Admin in:
 * Settings > Administration Panel > Roles (for each non–Super Admin role, uncheck Create under Department).
 */
module.exports = async (policyContext) => {
  policyContext.forbidden();
};
