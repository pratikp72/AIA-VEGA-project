const ALLOWED_PROFILE_FIELDS = [
  'username',
  'contact_no',
  'designation',
  'department',
  'working_location',
  'branch',
  'date_of_birth',
  'joining_date',
  'photograph',
  'email',
];

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

  async updateStatus(id, newStatus, adminUser) {
    try {
      const allowedStatus = ['Approved', 'Rejected'];
      if (!allowedStatus.includes(newStatus)) {
        throw new Error('Invalid request_status. Allowed values: Approved, Rejected');
      }

      // Support both documentId and numeric id to be resilient across callers.
      let request = await strapi.db.query('api::profile-edit-request.profile-edit-request').findOne({
        where: { documentId: id },
        populate: ['users_permissions_user'],
      });

      if (!request && Number.isInteger(Number(id))) {
        request = await strapi.db.query('api::profile-edit-request.profile-edit-request').findOne({
          where: { id: Number(id) },
          populate: ['users_permissions_user'],
        });
      }

      if (!request) {
        throw new Error('Profile edit request not found');
      }

      if (request.request_status && request.request_status !== 'Pending') {
        throw new Error('Only pending requests can be approved or rejected');
      }

      if (newStatus === 'Approved') {
        await this.applyProfileChanges(request);
      }

      const updated = await strapi.db.query('api::profile-edit-request.profile-edit-request').update({
        where: { id: request.id },
        data: {
          request_status: newStatus,
          reviewed_by: adminUser?.id || null,
          reviewed_at: new Date(),
        },
      });

      return updated;
    } catch (error) {
      strapi.log.error('Failed to update status:', error);
      throw error;
    }
  },

  async applyProfileChanges(requestRecord) {
    try {
      const request = requestRecord;
      if (!request || !request.users_permissions_user) {
        throw new Error('Request or user not found');
      }

      const requestIdentifier = request.documentId || request.id;
      const userDocumentId = request.users_permissions_user.documentId;
      const userId = request.users_permissions_user.id;
      const requestedChanges = request.requested_changes;

      if (!requestedChanges || typeof requestedChanges !== 'object') {
        throw new Error('No valid changes to apply');
      }

      // Filter requested changes to only include allowed fields
      const filteredChanges = {};
      Object.keys(requestedChanges).forEach((key) => {
        if (ALLOWED_PROFILE_FIELDS.includes(key)) {
          filteredChanges[key] = requestedChanges[key];
        } else {
          strapi.log.warn(`Skipping invalid field "${key}" in profile edit request ${requestIdentifier}`);
        }
      });

      if (Object.keys(filteredChanges).length === 0) {
        throw new Error('No valid changes to apply after filtering');
      }

      const userWhere = userDocumentId ? { documentId: userDocumentId } : { id: userId };
      await strapi.db.query('plugin::users-permissions.user').update({
        where: userWhere,
        data: filteredChanges,
      });

      strapi.log.info(
        `Profile changes applied for user ${userDocumentId || userId} from request ${requestIdentifier}:`,
        filteredChanges,
      );
    } catch (error) {
      strapi.log.error('Failed to apply profile changes:', error);
      throw error;
    }
  },
});
