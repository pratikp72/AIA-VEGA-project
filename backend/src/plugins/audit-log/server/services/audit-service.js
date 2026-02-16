module.exports = ({ strapi }) => ({
  async logChange({ action, contentType, entryId, adminUser, changes, data }) {
    try {
      // Get friendly collection name
      const contentTypeObj = strapi.contentTypes[contentType];
      const collectionName = contentTypeObj?.info?.displayName || contentType;

      await strapi.entityService.create('plugin::audit-log.audit-entry', {
        data: {
          action,
          contentType,
          collectionName,
          entryId,
          adminUser,
          changes: changes || null,
          snapshot: data || null,
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

    const entries = await strapi.entityService.findPage('plugin::audit-log.audit-entry', {
      page,
      pageSize,
      sort: `${sortBy}:${sortOrder}`,
      filters,
      populate: ['adminUser'],
    });

    return {
      data: entries.results.map(entry => ({
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
        data: entry.snapshot, // Include snapshot data (contains company, employee_name, etc.)
        createdAt: entry.createdAt,
      })),
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
