// @ts-nocheck
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

function runDetached(strapi, label, work) {
  Promise.resolve()
    .then(work)
    .catch((error) => {
      strapi.log.error(`[profile-edit-request] ${label}:`, error?.message || error);
    });
}

function parseMeta(meta) {
  if (!meta) return null;
  if (typeof meta === 'object') return meta;
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta);
    } catch {
      return null;
    }
  }
  return null;
}

async function findRequesterNameFromNotification(strapi, request) {
  try {
    const requestIds = [request?.documentId, request?.id]
      .filter(Boolean)
      .map((v) => String(v));

    if (requestIds.length === 0) return null;

    const row = await strapi.db
      .connection('notifications')
      .select('meta')
      .where('type', 'profile_edit_request')
      .andWhereRaw("meta ->> 'action' = ?", ['created'])
      .andWhere(function whereRequestId() {
        requestIds.forEach((rid, idx) => {
          if (idx === 0) this.whereRaw("meta ->> 'requestId' = ?", [rid]);
          else this.orWhereRaw("meta ->> 'requestId' = ?", [rid]);
        });
      })
      .orderBy('id', 'desc')
      .first();

    const meta = parseMeta(row?.meta);
    return meta?.userName || null;
  } catch (error) {
    strapi.log.warn(`[profile-edit-request] requester_name fallback lookup failed for request ${request?.id || request?.documentId}: ${error?.message || error}`);
    return null;
  }
}

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
    for (const entry of entries) {
      if (!entry.requester_name) {
        const historicalName = await findRequesterNameFromNotification(strapi, entry);
        if (historicalName) {
          entry.requester_name = historicalName;
          runDetached(strapi, `persist requester_name for request ${entry.id || entry.documentId}`, async () => {
            await strapi.db.query('api::profile-edit-request.profile-edit-request').update({
              where: { id: entry.id },
              data: { requester_name: historicalName },
            });
          });
        }
      }

      // Backfill old username snapshot for historical rows that predate previous_values storage.
      const requestedChanges = entry.requested_changes && typeof entry.requested_changes === 'object'
        ? entry.requested_changes
        : {};
      const hasUsernameChange = Object.prototype.hasOwnProperty.call(requestedChanges, 'username');
      const previousValues = entry.previous_values && typeof entry.previous_values === 'object'
        ? { ...entry.previous_values }
        : {};
      const hasOldUsername = Object.prototype.hasOwnProperty.call(previousValues, 'username');

      if (hasUsernameChange && !hasOldUsername && entry.requester_name) {
        previousValues.username = entry.requester_name;
        entry.previous_values = previousValues;

        runDetached(strapi, `persist previous_values.username for request ${entry.id || entry.documentId}`, async () => {
          await strapi.db.query('api::profile-edit-request.profile-edit-request').update({
            where: { id: entry.id },
            data: { previous_values: previousValues },
          });
        });
      }

      if (entry.users_permissions_user && typeof entry.users_permissions_user === 'object') {
        const user = entry.users_permissions_user;
        entry.userName = entry.requester_name || user.username || user.employee_name || user.name || '—';
        entry.userId = user.id || user.emp_id || '—';
        entry.userCompany = user.company || '—';
        entry.userContact = user.contact_no || '—';
      } else {
        entry.userName = entry.requester_name || '—';
        entry.userId = '—';
        entry.userCompany = '—';
        entry.userContact = '—';
      }
    }

    return entries;
  },

  async getPendingCount() {
    const count = await strapi.db.query('api::profile-edit-request.profile-edit-request').count({
      where: { request_status: 'Pending' },
    });
    return count || 0;
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

      const baseUpdateData = {
        request_status: newStatus,
        reviewed_by: adminUser?.id || null,
        reviewed_at: new Date(),
      };

      const updated = await strapi.db.query('api::profile-edit-request.profile-edit-request').update({
        where: { id: request.id },
        data: baseUpdateData,
      });

      if (!updated) {
        throw new Error('Failed to persist profile edit request status');
      }

      return {
        id: request.id,
        documentId: request.documentId,
        request_status: newStatus,
        reviewed_by: adminUser?.id || null,
        reviewed_at: baseUpdateData.reviewed_at,
      };
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
