import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_WORKFLOW_MODEL = 'api::course-workflow.course-workflow';

function isOffline(value) {
  return String(value || '').trim().toLowerCase() === 'offline';
}

function getRelationArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.set)) return raw.set;
    if (Array.isArray(raw.connect)) return raw.connect;
  }
  return [];
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

function getUniqueSelectedUsers(users) {
  const list = Array.isArray(users) ? users : [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const key = getUserKey(list[i], i);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(list[i]);
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

  const existingByUsername = new Map();
  for (const row of existingRows) {
    const key = typeof row?.username === 'string' ? row.username.trim() : '';
    if (!key || existingByUsername.has(key)) continue;
    existingByUsername.set(key, row);
  }

  const seenUserKeys = new Set();
  const out = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userKey = getUserKey(user, i);
    if (seenUserKeys.has(userKey)) continue;
    seenUserKeys.add(userKey);

    const username = getUserDisplayName(user);
    const byIndex = existingRows[i];
    const byName = username ? existingByUsername.get(username) : null;
    const existing = byName || byIndex || null;

    const finalUsername =
      (typeof username === 'string' && username.trim())
        ? username.trim()
        : (typeof existing?.username === 'string' && existing.username.trim())
          ? existing.username.trim()
          : `User #${i + 1}`;

    if (existing && typeof existing === 'object') {
      out.push({
        ...existing,
        username: finalUsername,
        __temp_key__: existing.__temp_key__ || tempKey('wf-offline', i),
      });
    } else {
      out.push({
        username: finalUsername,
        __temp_key__: tempKey('wf-offline', i),
      });
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

/**
 * For Course Workflow edit view:
 * - If module_type is Offline and users relation changes, create offline_module rows instantly.
 * - One row per selected user.
 * - username is auto-filled from selected relation label.
 */
function CourseWorkflowOfflineModuleSyncOnSelect({ slug, model }) {
  const uid = slug || model;
  const values = useForm('useContentManagerContext', (state) => state?.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state?.setValues, false);
  const prevSelectionSignatureRef = useRef('');
  const prevIsOfflineRef = useRef(false);

  useEffect(() => {
    if (uid !== COURSE_WORKFLOW_MODEL || !values || typeof setValues !== 'function') return;

    const nowOffline = isOffline(values.module_type);
    if (!nowOffline) {
      prevIsOfflineRef.current = false;
      prevSelectionSignatureRef.current = '';
      return;
    }

    const selectedUsersRaw = getRelationArray(values.users_permissions_users);
    const selectedUsers = getUniqueSelectedUsers(selectedUsersRaw);
    const selectionSignature = selectedUsers
      .map((user, i) => getUserKey(user, i))
      .join('|');

    const becameOffline = !prevIsOfflineRef.current && nowOffline;
    const selectionChanged = selectionSignature !== prevSelectionSignatureRef.current;
    prevIsOfflineRef.current = nowOffline;
    prevSelectionSignatureRef.current = selectionSignature;

    const nextRows = buildOfflineModuleFromUsers(selectedUsers, values.offline_module);
    const currentRows = Array.isArray(values.offline_module) ? values.offline_module : [];

    // Hard cap: do not allow creating more rows than selected users.
    if (currentRows.length > selectedUsers.length) {
      setValues({
        ...values,
        offline_module: nextRows,
      });
      return;
    }

    if (!becameOffline && !selectionChanged) return;

    if (sameUsernames(currentRows, nextRows)) return;

    setValues({
      ...values,
      offline_module: nextRows,
    });
  }, [uid, values, setValues]);

  return null;
}

export default CourseWorkflowOfflineModuleSyncOnSelect;
