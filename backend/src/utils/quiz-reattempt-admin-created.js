'use strict';

const TABLE = 'quiz_reattempt_requests';

function getRequestPath(strapi) {
  try {
    const ctx = strapi?.requestContext?.get?.();
    return (ctx?.request?.path || ctx?.path || ctx?.request?.url || '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * True only for Strapi Admin Panel creates (Content Manager / admin API).
 * Do not treat ctx.state.user as admin — that is often the portal user JWT.
 */
function isAdminPanelCreate(strapi) {
  try {
    const ctx = strapi?.requestContext?.get?.();
    if (!ctx) return false;

    if (ctx.state?.quizReattemptFromFrontend === true) {
      return false;
    }

    const path = getRequestPath(strapi);
    if (
      path.includes('/quiz-reattempt-request/send') ||
      path.includes('/quiz-reattempt-requests/send')
    ) {
      return false;
    }

    if (path.includes('/content-manager/')) {
      return true;
    }

    if (ctx.state?.admin?.id) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Strapi v5 may omit boolean false from db.query / documentService writes.
 * Use knex so admin_created is always persisted as true or false, never null.
 */
async function persistAdminCreated(strapi, recordId, adminCreated) {
  if (recordId == null) return;
  const knex = strapi.db.connection;
  await knex(TABLE)
    .where({ id: Number(recordId) })
    .update({ admin_created: Boolean(adminCreated) });
}

module.exports = {
  isAdminPanelCreate,
  persistAdminCreated,
};
