module.exports = ({ strapi }) => ({
  async logChange({ action, contentType, entryId, adminUser, changes, data }) {
    try {
      // Get friendly collection name
      const contentTypeObj = strapi.contentTypes[contentType];
      const collectionName = contentTypeObj?.info?.displayName || contentType;
      // Extract company from data (user snapshot)
      const company = data && data.company ? data.company : null;
      await strapi.entityService.create('plugin::audit-log.audit-entry', {
        data: {
          action,
          contentType,
          collectionName,
          entryId,
          adminUser,
          changes: changes || null,
          snapshot: data || null,
          company, // Store as top-level field
        },
      });
    } catch (error) {
      strapi.log.error('Failed to create audit log entry:', error);
    }
  },

  async getAuditLogs({ 
    page = 1, 
    pageSize = 25, 
    dateFrom = null, 
    dateTo = null, 
    contentType = null,
    action = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    company = null,
  }) {
    const filters = {};

    // Date filtering
    if (dateFrom || dateTo) {
      filters.createdAt = {};
      if (dateFrom) filters.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        filters.createdAt.$lte = endDate;
      }
    }

    // Content type filtering
    if (contentType && contentType !== '') {
      filters.contentType = { $eq: contentType };
    }

    // Action filtering
    if (action && action !== '') {
      filters.action = { $eq: action };
    }

    // Company filtering (now stored as top-level field)
    if (company && company !== '') {
      filters["company"] = { $eq: company };
    }

    const entries = await strapi.entityService.findPage('plugin::audit-log.audit-entry', {
      page,
      pageSize,
      sort: `${sortBy}:${sortOrder}`,
      filters,
      populate: ['adminUser'],
    });

    // TEMP: Log snapshot data for debugging company filter
    entries.results.forEach(entry => {
      const snapshot = entry.snapshot || {};
      strapi.log.info(`[AUDIT-LOG DEBUG] entryId=${entry.id} snapshot.company=`, snapshot.company, 'snapshot=', JSON.stringify(snapshot));
    });

    return {
      data: entries.results.map(entry => {
        // Extract userId and company from snapshot (if available)
        const snapshot = entry.snapshot || {};
        return {
          id: entry.id,
          action: entry.action,
          contentType: entry.contentType,
          collectionName: entry.collectionName,
          entryId: entry.entryId,
          adminUser: entry.adminUser ? {
            id: entry.adminUser.id,
            firstname: entry.adminUser.firstname,
            lastname: entry.adminUser.lastname,
            email: entry.adminUser.email,
          } : null,
          changes: entry.changes,
          data: snapshot, // Full snapshot for reference
          userId: snapshot.id || snapshot.userId || null,
          company: snapshot.company || null,
          createdAt: entry.createdAt,
        };
      }),
      pagination: entries.pagination,
    };
  },

  async getAvailableContentTypes() {
    // Only tracking users-permissions.user
    return [
      {
        uid: 'plugin::users-permissions.user',
        displayName: 'User/Employee',
      }
    ];
  },
});
