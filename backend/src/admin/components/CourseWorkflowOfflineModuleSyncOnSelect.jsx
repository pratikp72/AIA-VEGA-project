import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_WORKFLOW_MODEL = 'api::course-workflow.course-workflow';

function isOffline(value) {
  return String(value || '').trim().toLowerCase() === 'offline';
}

function getUsersCountFromDom() {
  const nodes = document.querySelectorAll('span, p, label, strong, h1, h2, h3, h4, h5, h6, div');
  for (const el of nodes) {
    if (el.childElementCount > 0) continue;
    const txt = (el.textContent || '').trim();
    const m = txt.match(/^users_permissions_users\s*\((\d+)\)$/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function getSelectedUsersFromRelation(raw, previousUsers) {
  const prev = Array.isArray(previousUsers) ? previousUsers : [];

  const getCount = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const candidates = [
      obj.count,
      obj.total,
      obj.meta?.count,
      obj.meta?.pagination?.total,
      obj.pagination?.total,
    ];
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c)) return c;
    }
    return null;
  };

  if (raw == null) {
    return { users: [], resolved: true };
  }

  if (typeof raw === 'string' && raw.trim() === '') {
    return { users: [], resolved: true };
  }

  if (Array.isArray(raw)) {
    return { users: getUniqueSelectedUsers(raw), resolved: true };
  }

  if (raw && typeof raw === 'object') {
    if (Object.keys(raw).length === 0) {
      return { users: [], resolved: true };
    }

    let next = null;

    if (Array.isArray(raw.set)) {
      next = getUniqueSelectedUsers(raw.set);
    } else if (Array.isArray(raw.data)) {
      next = getUniqueSelectedUsers(raw.data);
    } else if (Array.isArray(raw.results)) {
      next = getUniqueSelectedUsers(raw.results);
    }

    const connectList = Array.isArray(raw.connect) ? raw.connect : [];
    const disconnectList = Array.isArray(raw.disconnect) ? raw.disconnect : [];
    const hasConnect = connectList.length > 0;
    const hasDisconnect = disconnectList.length > 0;
    const hasBaseList = Array.isArray(raw.set) || Array.isArray(raw.data) || Array.isArray(raw.results);

    // When connect exists without a base list, it represents the full selected state
    if ((hasConnect || hasDisconnect) && !hasBaseList) {
      return { users: getUniqueSelectedUsers(connectList), resolved: true };
    }

    if (hasConnect || hasDisconnect) {
      if (!next) next = [...prev];

      if (hasDisconnect) {
        const toRemove = disconnectList;
        const beforeLen = next.length;
        next = next.filter((existingUser) => !toRemove.some((u) => usersMatch(existingUser, u)));
        const removedByMatch = beforeLen - next.length;

        if (!hasBaseList && !hasConnect && removedByMatch < toRemove.length) {
          const deficit = toRemove.length - removedByMatch;
          next = next.slice(0, Math.max(0, next.length - deficit));
        }
      }

      if (hasConnect) {
        connectList.forEach((u) => {
          if (!next.some((existingUser) => usersMatch(existingUser, u))) {
            next.push(u);
          }
        });
      }

      return { users: getUniqueSelectedUsers(next), resolved: true };
    }

    if (next) {
      return { users: next, resolved: true };
    }

    const count = getCount(raw);
    if (count != null) {
      if (count <= 0) return { users: [], resolved: true };
      if (count < prev.length) return { users: prev.slice(0, count), resolved: true };
    }

    const relationKeys = ['set', 'data', 'results', 'connect', 'disconnect'];
    if (relationKeys.some((k) => Object.prototype.hasOwnProperty.call(raw, k))) {
      return { users: [], resolved: true };
    }
  }

  return { users: prev, resolved: false };
}

function getUserDisplayName(user) {
  if (!user || typeof user !== 'object') return null;

  const candidates = [
    user.username,
    user.email,
    user.label,
    user.displayName,
    user.mainField,
    user.name,
    user.value?.label,
    user.attributes?.username,
    user.attributes?.email,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  const fallbackId = user.id ?? user.documentId ?? user.value;
  if (fallbackId != null && String(fallbackId).trim()) return `User #${String(fallbackId).trim()}`;

  return null;
}

function getUserIdentityTokens(user) {
  if (!user || typeof user !== 'object') return [];

  const tokens = [];
  const add = (prefix, value) => {
    if (value == null) return;
    const s = String(value).trim();
    if (!s) return;
    tokens.push(`${prefix}:${s.toLowerCase()}`);
  };

  add('id', user.id);
  add('doc', user.documentId);
  add('id', user.value?.id);
  add('doc', user.value?.documentId);

  add('name', user.username);
  add('name', user.email);
  add('name', user.label);
  add('name', user.displayName);
  add('name', user.mainField);
  add('name', user.name);
  add('name', user.value?.label);
  add('name', user.attributes?.username);
  add('name', user.attributes?.email);

  return [...new Set(tokens)];
}

function usersMatch(a, b) {
  const left = getUserIdentityTokens(a);
  if (left.length === 0) return false;
  const right = new Set(getUserIdentityTokens(b));
  return left.some((t) => right.has(t));
}

function getUniqueSelectedUsers(users) {
  const list = Array.isArray(users) ? users : [];
  const out = [];

  for (const user of list) {
    if (!out.some((u) => usersMatch(u, user))) {
      out.push(user);
    }
  }

  return out;
}

function getUserKey(user, index) {
  if (!user || typeof user !== 'object') return `idx:${index}`;
  if (user.id != null) return `id:${String(user.id)}`;
  if (user.documentId) return `doc:${String(user.documentId)}`;

  if (user.value != null) {
    if (typeof user.value === 'object') {
      if (user.value.id != null) return `id:${String(user.value.id)}`;
      if (user.value.documentId) return `doc:${String(user.value.documentId)}`;
    }
    return `val:${String(user.value)}`;
  }

  return `idx:${index}`;
}

function tempKey(prefix, i) {
  return `${prefix}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildOfflineModuleFromUsers(users, currentRows) {
  const existingRows = Array.isArray(currentRows) ? currentRows : [];

  const out = [];
  const processedUserKeys = new Set();

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userKey = getUserKey(user, i);

    if (processedUserKeys.has(userKey)) continue;
    processedUserKeys.add(userKey);

    const username = getUserDisplayName(user);

    let existing = null;
    for (const row of existingRows) {
      if (row?.username === username) {
        existing = row;
        break;
      }
    }

    const finalUsername = username || existing?.username || `User #${i + 1}`;

    if (existing) {
      out.push({ ...existing, username: finalUsername });
    } else {
      out.push({ username: finalUsername, __temp_key__: tempKey('wf-offline', i) });
    }
  }

  return out;
}

function sameUsernames(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (String(left[i]?.username || '') !== String(right[i]?.username || '')) return false;
  }
  return true;
}

function getWorkflowItemsFromValues(values) {
  if (Array.isArray(values?.modules)) return values.modules;
  if (Array.isArray(values?.workflow)) return values.workflow;
  return [];
}

function withUpdatedWorkflowItems(values, nextWorkflowItems) {
  if (Array.isArray(values?.modules)) {
    return {
      ...values,
      modules: nextWorkflowItems,
    };
  }

  return {
    ...values,
    workflow: nextWorkflowItems,
  };
}

function syncWorkflowOfflineModules(workflowItems, selectedUsers) {
  let changed = false;

  const nextWorkflowItems = workflowItems.map((item) => {
    if (!isOffline(item?.module_type)) return item;

    const currentRows = Array.isArray(item?.offline_module) ? item.offline_module : [];
    const nextRows = buildOfflineModuleFromUsers(selectedUsers, currentRows);

    if (sameUsernames(currentRows, nextRows)) return item;

    changed = true;
    return {
      ...item,
      offline_module: nextRows,
    };
  });

  return { changed, nextWorkflowItems };
}

function CourseWorkflowOfflineModuleSyncOnSelect({ slug, model }) {
  const uid = slug || model;
  const values = useForm('useContentManagerContext', (state) => state?.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state?.setValues, false);
  const lastSelectedUsersRef = useRef([]);

  useEffect(() => {
    if (uid !== COURSE_WORKFLOW_MODEL || !values || typeof setValues !== 'function') return;

    const selectedUsersRaw = values.users_permissions_users;
    const { users: selectedUsers, resolved } = getSelectedUsersFromRelation(
      selectedUsersRaw,
      lastSelectedUsersRef.current,
    );

    let effectiveUsers = selectedUsers;
    const domCount = getUsersCountFromDom();

    if (typeof domCount === 'number') {
      if (domCount <= 0) {
        effectiveUsers = [];
      } else if (effectiveUsers.length > domCount) {
        effectiveUsers = effectiveUsers.slice(0, domCount);
      } else if (effectiveUsers.length < domCount && lastSelectedUsersRef.current.length >= domCount) {
        effectiveUsers = lastSelectedUsersRef.current.slice(0, domCount);
      }
    }

    if (!resolved && typeof domCount !== 'number') return;

    lastSelectedUsersRef.current = effectiveUsers;

    const workflowItems = getWorkflowItemsFromValues(values);
    if (workflowItems.length === 0) return;

    const { changed, nextWorkflowItems } = syncWorkflowOfflineModules(workflowItems, effectiveUsers);
    if (!changed) return;

    setValues(withUpdatedWorkflowItems(values, nextWorkflowItems));
  }, [uid, values, setValues]);

  return null;
}

export default CourseWorkflowOfflineModuleSyncOnSelect;
