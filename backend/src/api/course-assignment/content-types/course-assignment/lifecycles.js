// @ts-nocheck
'use strict';

const { errors } = require('@strapi/utils');
const { ValidationError } = errors;

function isNumericId(value) {
  return typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(String(value)));
}

function extractRelationIds(raw) {
  if (raw == null) return [];
  if (isNumericId(raw)) return [Number(raw)];

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (isNumericId(item)) return Number(item);
        if (item && typeof item === 'object' && isNumericId(item.id)) return Number(item.id);
        return null;
      })
      .filter(Boolean);
  }

  if (typeof raw === 'object') {
    const items = Array.isArray(raw.set)
      ? raw.set
      : Array.isArray(raw.connect)
        ? raw.connect
        : raw.id != null
          ? [raw]
          : [];

    return items
      .map((item) => {
        if (isNumericId(item)) return Number(item);
        if (item && typeof item === 'object' && isNumericId(item.id)) return Number(item.id);
        return null;
      })
      .filter(Boolean);
  }

  return [];
}

function isPublishIntent(data) {
  return data?.publishedAt != null || data?.published_at != null;
}

async function getExistingAssignment(where) {
  if (!where) return null;

  return await strapi.db.query('api::course-assignment.course-assignment').findOne({
    where,
    select: ['id', 'documentId', 'assignment_target_type', 'publishedAt'],
    populate: {
      individual_user: {
        select: ['id'],
      },
    },
  });
}

function getExistingUserCount(existingAssignment) {
  const users = existingAssignment?.individual_user;
  if (!Array.isArray(users)) return 0;
  return users.filter((user) => user?.id != null).length;
}

async function validateIndividualPublish(data, where) {
  if (!isPublishIntent(data)) return;

  const existingAssignment = await getExistingAssignment(where);
  const targetType = data?.assignment_target_type ?? existingAssignment?.assignment_target_type;
  if (String(targetType || '').toLowerCase() !== 'individual') return;

  const incomingUserIds = extractRelationIds(data?.individual_user);
  const hasUsers = incomingUserIds.length > 0 || getExistingUserCount(existingAssignment) > 0;

  if (!hasUsers) {
    throw new ValidationError(
      'Individual course assignments cannot be published without importing an Excel file that adds at least one user.'
    );
  }
}

module.exports = {
  async beforeCreate(event) {
    await validateIndividualPublish(event.params?.data, null);
  },

  async beforeUpdate(event) {
    await validateIndividualPublish(event.params?.data, event.params?.where);
  },
};