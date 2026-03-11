module.exports = ({ strapi }) => ({
  async getAll() {
    const entries = await strapi.entityService.findMany('api::profile-edit-request.profile-edit-request', {
      populate: {
        users_permissions_user: true, // Populate all user fields
        reviewed_by: {
          fields: ['firstname', 'lastname'],
        },
      },
      sort: { createdAt: 'desc' },
    });
    // Ensure all user fields are present
    return entries.map((entry) => {
      if (entry.users_permissions_user && typeof entry.users_permissions_user === 'object') {
        const user = entry.users_permissions_user;
        entry.userName = user.username || user.employee_name || user.name || '—';
        entry.userId = user.id || user.emp_id || '—';
        entry.userCompany = user.company || '—';
        entry.userContact = user.contact_no || '—';
      } else {
        entry.userName = '—';
        entry.userId = '—';
        entry.userCompany = '—';
        entry.userContact = '—';
      }
      return entry;
    });
  },

  async updateStatus(id, newStatus, adminComment, adminUser) {
    try {
      // Use db.query to update by documentId
      const updated = await strapi.db.query('api::profile-edit-request.profile-edit-request').update({
        where: { documentId: id },
        data: {
          request_status: newStatus,
          admin_comment: adminComment || null,
          reviewed_by: adminUser?.id || null,
          reviewed_at: new Date(),
        },
      });

      // If approved, apply the changes to the user profile
      if (newStatus === 'Approved') {
        await this.applyProfileChanges(id);
      }

      return updated;
    } catch (error) {
      strapi.log.error('Failed to update status:', error);
      throw error;
    }
  },

  async applyProfileChanges(requestDocumentId) {
    try {
      // Get the request with populated user using db.query
      const request = await strapi.db.query('api::profile-edit-request.profile-edit-request').findOne({
        where: { documentId: requestDocumentId },
        populate: ['users_permissions_user'],
      });

      if (!request || !request.users_permissions_user) {
        throw new Error('Request or user not found');
      }

      const userDocumentId = request.users_permissions_user.documentId;
      const requestedChanges = request.requested_changes;

      if (!requestedChanges || typeof requestedChanges !== 'object') {
        throw new Error('No valid changes to apply');
      }

      // Whitelist of allowed fields for profile edits
      const allowedFields = [
        'employee_name',
        'contact_no',
        'designation',
        'department',
        'working_location',
        'branch',
        'description',
        'date_of_birth',
        'age',
      ];

      // Filter requested changes to only include allowed fields
      const filteredChanges = {};
      Object.keys(requestedChanges).forEach(key => {
        if (allowedFields.includes(key)) {
          filteredChanges[key] = requestedChanges[key];
        } else {
          strapi.log.warn(`Skipping invalid field "${key}" in profile edit request ${requestDocumentId}`);
        }
      });

      if (Object.keys(filteredChanges).length === 0) {
        throw new Error('No valid changes to apply after filtering');
      }

      // Update the user profile with the filtered changes using db.query
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { documentId: userDocumentId },
        data: filteredChanges,
      });

      strapi.log.info(`Profile changes applied for user ${userDocumentId} from request ${requestDocumentId}:`, filteredChanges);
    } catch (error) {
      strapi.log.error('Failed to apply profile changes:', error);
      throw error;
    }
  },
});
