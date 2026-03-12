'use strict';

const COURSE_WORKFLOW_UID = 'api::course-workflow.course-workflow';
const USER_UID = 'plugin::users-permissions.user';

function isOfflineModuleType(value) {
  return String(value || '').trim().toLowerCase() === 'offline';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDisplayName(user) {
  return user?.username || user?.email || (user?.id != null ? `User #${user.id}` : null);
}

function buildOfflineModuleEntries(users, baseEntries) {
  const byUsername = new Map();
  for (const entry of Array.isArray(baseEntries) ? baseEntries : []) {
    const key = typeof entry?.username === 'string' ? entry.username.trim() : '';
    if (!key || byUsername.has(key)) continue;
    byUsername.set(key, entry);
  }

  const out = [];
  for (const user of users) {
    const username = getDisplayName(user);
    if (!username) continue;
    const existing = byUsername.get(username) || {};
    out.push({ ...existing, username });
  }

  return out;
}

function sameUsernameOrder(current, next) {
  const a = Array.isArray(current) ? current : [];
  const b = Array.isArray(next) ? next : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (String(a[i]?.username || '') !== String(b[i]?.username || '')) return false;
  }
  return true;
}

function toWorkflowWhere(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.id != null) return { id: input.id };
  if (input.documentId) return { documentId: input.documentId };
  return null;
}

async function loadWorkflow(strapi, workflowLike) {
  const where = toWorkflowWhere(workflowLike);
  if (!where) return null;

  return strapi.db.query(COURSE_WORKFLOW_UID).findOne({
    where,
    select: ['id', 'documentId', 'module_type'],
    populate: {
      offline_module: true,
    },
  });
}

async function loadUserByWhere(strapi, where) {
  if (!where || typeof where !== 'object') return null;
  return strapi.db.query(USER_UID).findOne({
    where,
    select: ['id', 'documentId'],
    populate: { course_workflow: { select: ['id', 'documentId'] } },
  });
}

function toWorkflowRef(value) {
  if (value == null) return null;
  if (typeof value === 'number') return { id: value };
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) && String(n) === String(value).trim() ? { id: n } : { documentId: value };
  }
  if (typeof value === 'object') {
    const id = value.id ?? null;
    const documentId = value.documentId ?? value.document_id ?? null;
    if (id != null) return { id };
    if (documentId) return { documentId };
  }
  return null;
}

async function getSelectedUsersForWorkflow(strapi, workflow) {
  if (!workflow?.id) return [];

  // Relation owner is users-permissions user (manyToOne), so fetch users by FK.
  const users = await strapi.db.query(USER_UID).findMany({
    where: { course_workflow: workflow.id },
    select: ['id', 'documentId', 'username', 'email'],
    orderBy: { id: 'asc' },
  });

  return Array.isArray(users) ? users : [];
}

async function syncOfflineModuleForWorkflow(strapi, workflowLike) {
  let workflow = await loadWorkflow(strapi, workflowLike);
  if (!workflow) return;

  if (!isOfflineModuleType(workflow.module_type)) return;

  let users = await getSelectedUsersForWorkflow(strapi, workflow);
  if (users.length === 0) {
    // In some flows relation updates are applied right after workflow save.
    await sleep(200);
    workflow = await loadWorkflow(strapi, workflow);
    if (!workflow || !isOfflineModuleType(workflow.module_type)) return;
    users = await getSelectedUsersForWorkflow(strapi, workflow);
  }

  const current = Array.isArray(workflow.offline_module) ? workflow.offline_module : [];
  const desired = buildOfflineModuleEntries(users, current);

  if (sameUsernameOrder(current, desired)) return;

  await strapi.db.query(COURSE_WORKFLOW_UID).update({
    where: { id: workflow.id },
    data: { offline_module: desired },
  });
}

async function syncWorkflowFromUserEvent(strapi, event) {
  const where = event?.params?.where;
  const data = event?.params?.data;

  const previousUser = event.action === 'beforeUpdate'
    ? await loadUserByWhere(strapi, where)
    : null;

  if (event.action === 'beforeUpdate') {
    event.state = event.state || {};
    event.state.previousWorkflowRef = toWorkflowRef(previousUser?.course_workflow);
    return;
  }

  const currentResult = event?.result;
  let currentUser = null;
  if (currentResult?.id != null) {
    currentUser = await loadUserByWhere(strapi, { id: currentResult.id });
  } else if (currentResult?.documentId) {
    currentUser = await loadUserByWhere(strapi, { documentId: currentResult.documentId });
  }

  const currentWorkflowRef = toWorkflowRef(currentUser?.course_workflow);
  const previousWorkflowRef = toWorkflowRef(event?.state?.previousWorkflowRef);

  const targets = [];
  const seen = new Set();
  for (const ref of [previousWorkflowRef, currentWorkflowRef, toWorkflowRef(data?.course_workflow)]) {
    const key = ref?.id != null ? `id:${ref.id}` : ref?.documentId ? `doc:${ref.documentId}` : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push(ref);
  }

  for (const ref of targets) {
    await syncOfflineModuleForWorkflow(strapi, ref);
  }
}

function registerCourseWorkflowOfflineModuleSync(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [COURSE_WORKFLOW_UID],
    async afterCreate(event) {
      try {
        await syncOfflineModuleForWorkflow(strapi, event?.result);
      } catch (e) {
        strapi.log.error('[course-workflow] offline module sync afterCreate failed:', e?.message || e);
      }
    },
    async afterUpdate(event) {
      try {
        await syncOfflineModuleForWorkflow(strapi, event?.result);
      } catch (e) {
        strapi.log.error('[course-workflow] offline module sync afterUpdate failed:', e?.message || e);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [USER_UID],
    async beforeUpdate(event) {
      try {
        await syncWorkflowFromUserEvent(strapi, event);
      } catch (e) {
        strapi.log.error('[course-workflow] user beforeUpdate sync prep failed:', e?.message || e);
      }
    },
    async afterCreate(event) {
      try {
        await syncWorkflowFromUserEvent(strapi, event);
      } catch (e) {
        strapi.log.error('[course-workflow] user afterCreate sync failed:', e?.message || e);
      }
    },
    async afterUpdate(event) {
      try {
        await syncWorkflowFromUserEvent(strapi, event);
      } catch (e) {
        strapi.log.error('[course-workflow] user afterUpdate sync failed:', e?.message || e);
      }
    },
  });

  strapi.log.info('Course-workflow offline-module sync is enabled');
}

module.exports = { registerCourseWorkflowOfflineModuleSync };
