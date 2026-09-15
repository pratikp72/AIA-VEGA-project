// @ts-nocheck
'use strict';

const USER_PROGRESS_UID = 'api::user-progress.user-progress';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';

let _creatingSubEntries = false;
let _backfillingDueDates = false;
const _prevDueDateByProgressKey = new Map();
const _dueDateNotificationSentProgressKeys = new Set();
const _assignmentUserDiffHandledKeys = new Set();
/** Prevents duplicate bell/email for same type+course+user within a short window */
const _assignmentNotificationClaimKeys = new Set();
/** documentId → { userIds, courseIds, pendingRemoved } captured BEFORE draft update mutates relations */
const _prevAssignmentUsersByDocId = new Map();
/** `${numericCourseId}:${userId}` → set when course_unassigned is sent (same-process re-add signal) */
const _recentCourseUnassignKeys = new Set();

function markAssignmentDiffHandled(documentId, ttlMs = 15000) {
  const key = String(documentId || '');
  if (!key) return;
  _assignmentUserDiffHandledKeys.add(key);
  setTimeout(() => _assignmentUserDiffHandledKeys.delete(key), ttlMs);
}

function isAssignmentDiffHandled(documentId) {
  const key = String(documentId || '');
  return Boolean(key && _assignmentUserDiffHandledKeys.has(key));
}

function markRecentCourseUnassign(numericCourseId, userIds, ttlMs = 300000) {
  const courseKey = Number(numericCourseId);
  if (!Number.isFinite(courseKey) || courseKey <= 0) return;
  for (const rawId of userIds || []) {
    const uid = Number(rawId);
    if (!Number.isFinite(uid) || uid <= 0) continue;
    const key = `${courseKey}:${uid}`;
    _recentCourseUnassignKeys.add(key);
    setTimeout(() => _recentCourseUnassignKeys.delete(key), ttlMs);
  }
}

function wasRecentlyUnassignedFromCourse(numericCourseId, userId) {
  const courseKey = Number(numericCourseId);
  const uid = Number(userId);
  if (!Number.isFinite(courseKey) || !Number.isFinite(uid)) return false;
  return _recentCourseUnassignKeys.has(`${courseKey}:${uid}`);
}

/**
 * Claim user ids for a notification send. Returns only ids not already claimed
 * for the same type+course in the TTL window (stops middleware + afterCreate doubles).
 * Assign/reassign are mutually exclusive per user+course.
 */
function claimAssignmentNotificationRecipients(type, courseId, userIds, ttlMs = 20000) {
  const numericCourseId = Number(courseId);
  const coursePart = Number.isFinite(numericCourseId) ? numericCourseId : courseId;
  const siblingTypes =
    type === 'course_assigned'
      ? ['course_reassigned']
      : type === 'course_reassigned'
        ? ['course_assigned']
        : [];
  const claimed = [];
  for (const rawId of userIds || []) {
    const uid = Number(rawId);
    if (!Number.isFinite(uid) || uid <= 0) continue;
    const key = `${type}:${coursePart}:${uid}`;
    if (_assignmentNotificationClaimKeys.has(key)) continue;
    const siblingTaken = siblingTypes.some((sib) =>
      _assignmentNotificationClaimKeys.has(`${sib}:${coursePart}:${uid}`)
    );
    if (siblingTaken) continue;
    _assignmentNotificationClaimKeys.add(key);
    setTimeout(() => _assignmentNotificationClaimKeys.delete(key), ttlMs);
    for (const sib of siblingTypes) {
      const sibKey = `${sib}:${coursePart}:${uid}`;
      _assignmentNotificationClaimKeys.add(sibKey);
      setTimeout(() => _assignmentNotificationClaimKeys.delete(sibKey), ttlMs);
    }
    claimed.push(uid);
  }
  return claimed;
}

function getProgressLifecycleKey(record) {
  if (!record) return '';
  return String(record.documentId ?? record.id ?? '');
}

async function loadProgressFromWhere(strapi, where) {
  if (!where || typeof where !== 'object') return null;
  try {
    let id = where.id != null ? Number(where.id) : null;
    let documentId = where.documentId != null ? String(where.documentId) : null;

    if ((!id || Number.isNaN(id)) && !documentId && Array.isArray(where.$and)) {
      for (const clause of where.$and) {
        if (clause?.id != null && !id) id = Number(clause.id);
        if (clause?.documentId != null && !documentId) documentId = String(clause.documentId);
      }
    }

    if (id != null && !Number.isNaN(id)) {
      return await strapi.db.query(USER_PROGRESS_UID).findOne({
        where: { id },
        select: ['id', 'documentId', 'due_date', 'progress_status', 'publishedAt'],
        populate: {
          user: { select: ['id'] },
          course: { select: ['id'] },
        },
      });
    }
    if (documentId) {
      return await strapi.db.query(USER_PROGRESS_UID).findOne({
        where: { documentId },
        select: ['id', 'documentId', 'due_date', 'progress_status', 'publishedAt'],
        populate: {
          user: { select: ['id'] },
          course: { select: ['id'] },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Capture previous due_date before user-progress update so afterUpdate can notify.
 * Due dates are per-user on user-progress (not course-assignment).
 */
async function captureUserProgressDueDateChange(strapi, data, where) {
  if (_creatingSubEntries || _backfillingDueDates || !data || data.due_date === undefined) return;

  const existing = await loadProgressFromWhere(strapi, where);
  if (!existing) return;

  const key = getProgressLifecycleKey(existing);
  if (!key) return;

  const previousDueDate = formatDueDateValue(existing.due_date);
  const nextDueDate = formatDueDateValue(data.due_date);
  _prevDueDateByProgressKey.set(key, previousDueDate);

  if (nextDueDate !== previousDueDate) {
    strapi.log.info(
      'user-progress-automation: user-progress due_date change captured for %s (%s -> %s)',
      key,
      previousDueDate || 'n/a',
      nextDueDate || 'n/a'
    );
  }
}

/**
 * Notify the single user when their user-progress due_date changes.
 * Skips first stamp (null -> value) and Completed users.
 */
async function sendDueDateChangedForUserProgress(strapi, result, params = {}) {
  if (_creatingSubEntries || _backfillingDueDates || !result) return false;

  const key = getProgressLifecycleKey(result);
  if (key && _dueDateNotificationSentProgressKeys.has(key)) {
    strapi.log.info(
      'user-progress-automation: skip duplicate due_date_changed for user-progress %s',
      key
    );
    return false;
  }

  let userId = getUserId(result.user) ?? result.user_id ?? null;
  let courseId = getCourseId(result.course) ?? result.course_id ?? null;
  let progressStatus = result.progress_status;

  if (userId == null || courseId == null || progressStatus == null) {
    try {
      const full = await strapi.db.query(USER_PROGRESS_UID).findOne({
        where: result.id != null ? { id: Number(result.id) } : { documentId: String(result.documentId) },
        select: ['id', 'documentId', 'due_date', 'progress_status'],
        populate: {
          user: { select: ['id'] },
          course: { select: ['id'] },
        },
      });
      if (full) {
        userId = userId ?? getUserId(full.user);
        courseId = courseId ?? getCourseId(full.course);
        progressStatus = progressStatus ?? full.progress_status;
      }
    } catch (e) {
      strapi.log.warn('user-progress-automation: failed loading user-progress for due_date notify: %s', e?.message || e);
    }
  }

  userId = userId != null ? Number(userId) : null;
  if (!userId || !courseId) return false;
  if (progressStatus === 'Completed') {
    strapi.log.info(
      'user-progress-automation: skip due_date_changed — user %s already completed course %s',
      userId,
      courseId
    );
    return false;
  }

  const due_date = params?.data?.due_date ?? result?.due_date;
  await sendDueDateChangedNotifications(strapi, result, {
    courseId,
    userIds: [userId],
    due_date,
  });

  if (key) {
    _dueDateNotificationSentProgressKeys.add(key);
    setTimeout(() => _dueDateNotificationSentProgressKeys.delete(key), 10000);
  }
  return true;
}

/**
 * Content Manager / Document Service path (Strapi 5).
 * Admin edits go through documents().update / publish — db lifecycles alone often miss due_date.
 */
async function handleUserProgressDueDateDocumentMiddleware(strapi, context, next) {
  if (_creatingSubEntries || _backfillingDueDates) {
    return await next();
  }

  const action = context?.action;
  if (!['update', 'publish'].includes(action)) {
    return await next();
  }

  const documentId =
    context.params?.documentId
    || context.params?.where?.documentId
    || null;

  let previousDueDate = '';
  let previousRecord = null;

  if (documentId) {
    try {
      previousRecord = await strapi.db.query(USER_PROGRESS_UID).findOne({
        where: {
          documentId: String(documentId),
          publishedAt: { $notNull: true },
        },
        select: ['id', 'documentId', 'due_date', 'progress_status', 'publishedAt'],
        populate: {
          user: { select: ['id'] },
          course: { select: ['id'] },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!previousRecord) {
        previousRecord = await strapi.db.query(USER_PROGRESS_UID).findOne({
          where: { documentId: String(documentId) },
          select: ['id', 'documentId', 'due_date', 'progress_status', 'publishedAt'],
          populate: {
            user: { select: ['id'] },
            course: { select: ['id'] },
          },
          orderBy: { updatedAt: 'desc' },
        });
      }
      previousDueDate = formatDueDateValue(previousRecord?.due_date);
    } catch (e) {
      strapi.log.warn(
        'user-progress-automation: documents.use failed loading previous due_date: %s',
        e?.message || e
      );
    }
  }

  const incomingDueDate =
    context.params?.data && Object.prototype.hasOwnProperty.call(context.params.data, 'due_date')
      ? formatDueDateValue(context.params.data.due_date)
      : null;

  // Draft-only update with no publish intent: wait for publish action.
  if (action === 'update') {
    const status = context.params?.status;
    const publishingNow = status === 'published';
    if (!publishingNow && incomingDueDate == null) {
      return await next();
    }
    // Still run next(); notification decision happens after.
  }

  const result = await next();
  const resultDoc = result?.document ?? result;

  try {
    const status = context.params?.status;
    const isPublishedResult =
      resultDoc?.publishedAt != null
      || resultDoc?.published_at != null
      || status === 'published'
      || action === 'publish';

    if (!isPublishedResult) {
      // Draft save — notify when they publish.
      if (incomingDueDate != null && previousDueDate && incomingDueDate !== previousDueDate) {
        strapi.log.info(
          'user-progress-automation: due_date changed on draft (documentId=%s, %s -> %s) — will notify on publish',
          documentId || 'n/a',
          previousDueDate,
          incomingDueDate
        );
      }
      return result;
    }

    const newDueDate = formatDueDateValue(
      incomingDueDate != null
        ? incomingDueDate
        : (resultDoc?.due_date ?? previousRecord?.due_date)
    );

    // For publish, re-read result if needed
    let notifyResult = resultDoc;
    if ((!notifyResult || (!notifyResult.user && !notifyResult.course)) && documentId) {
      notifyResult = await strapi.db.query(USER_PROGRESS_UID).findOne({
        where: {
          documentId: String(documentId),
          publishedAt: { $notNull: true },
        },
        select: ['id', 'documentId', 'due_date', 'progress_status', 'publishedAt'],
        populate: {
          user: { select: ['id'] },
          course: { select: ['id'] },
        },
        orderBy: { updatedAt: 'desc' },
      }) || notifyResult || previousRecord;
    }

    const effectiveNew = formatDueDateValue(notifyResult?.due_date ?? newDueDate);

    if (!previousDueDate || !effectiveNew || previousDueDate === effectiveNew) {
      return result;
    }

    strapi.log.info(
      'user-progress-automation: documents.%s due_date changed (documentId=%s, %s -> %s)',
      action,
      documentId || 'n/a',
      previousDueDate,
      effectiveNew
    );

    await sendDueDateChangedForUserProgress(strapi, notifyResult, {
      data: { due_date: effectiveNew },
    });
  } catch (e) {
    strapi.log.error(
      'user-progress-automation (documents.%s due_date): %s',
      action,
      e?.message || e
    );
  }

  return result;
}

function formatDueDateValue(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).trim();
  return d.toISOString().slice(0, 10);
}

function formatDueDateForDisplay(value) {
  const normalized = formatDueDateValue(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  if (!year || !month || !day) return normalized;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = months[Number(month) - 1] || month;
  return `${day} ${monthLabel} ${year}`;
}

async function isRepublicationAfterEdit(strapi, result) {
  const documentId = result?.documentId;
  const rowId = result?.id;
  if (!documentId || rowId == null) return false;

  try {
    const siblings = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: {
        documentId: String(documentId),
        id: { $ne: Number(rowId) },
      },
      select: ['id', 'publishedAt'],
    });
    if (!Array.isArray(siblings) || siblings.length === 0) return false;

    // First publish: published row + single draft sibling only.
    if (siblings.length === 1 && !siblings[0].publishedAt) return false;

    if (siblings.some((row) => row.publishedAt)) return true;
    return siblings.length > 1;
  } catch {
    return false;
  }
}

async function getPreviousPublishedAssignmentUserIds(strapi, result) {
  const documentId = result?.documentId;
  const rowId = result?.id;
  if (!documentId || rowId == null) return [];

  try {
    const previous = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: {
        documentId: String(documentId),
        id: { $ne: Number(rowId) },
        publishedAt: { $notNull: true },
      },
      select: ['id', 'documentId', 'assignment_target_type'],
      orderBy: { updatedAt: 'desc' },
    });
    if (!previous?.id) return [];

    const payload = await getAssignedUserIds(strapi, previous.id);
    return [...new Set((payload?.userIds || []).map(Number).filter(Boolean))];
  } catch (e) {
    strapi.log.warn(
      'user-progress-automation: failed loading previous assignment users: %s',
      e?.message || e
    );
    return [];
  }
}

async function sendCourseUnassignedNotifications(strapi, userIds, courseIds) {
  const notifUtil = strapi.utils?.notification;
  const uniqueUserIds = [...new Set((userIds || []).map(Number).filter(Boolean))];
  const uniqueCourseIds = [...new Set((courseIds || []).filter(Boolean))];
  if (!notifUtil || !uniqueUserIds.length || !uniqueCourseIds.length) return;

  let users = [];
  try {
    users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { id: { $in: uniqueUserIds } },
      select: ['id', 'email', 'username'],
    });
  } catch (e) {
    strapi.log.warn('user-progress-automation: failed loading users for course_unassigned: %s', e?.message || e);
    return;
  }
  if (!users.length) return;

  for (const rawCourseId of uniqueCourseIds) {
    const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
    if (!numericCourseId) continue;

    const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);
    try {
      const recipients = claimAssignmentNotificationRecipients(
        'course_unassigned',
        numericCourseId,
        users.map((u) => u.id)
      )
        .map((id) => users.find((u) => Number(u.id) === id))
        .filter(Boolean);
      if (!recipients.length) {
        strapi.log.info(
          'user-progress-automation: skip duplicate course_unassigned for courseId=%s',
          numericCourseId
        );
        continue;
      }
      strapi.log.info(
        'user-progress-automation: sending course_unassigned to %d user(s) for courseId=%s',
        recipients.length,
        numericCourseId
      );
      await notifUtil.sendNotification(
        'course_unassigned',
        'Course Enrollment Update',
        `You are no longer eligible for "${courseTitle}". Your enrollment has been updated. Please contact your administrator if you have any questions.`,
        recipients,
        { courseId: numericCourseId },
        []
      );
      markRecentCourseUnassign(
        numericCourseId,
        recipients.map((u) => u.id)
      );
    } catch (e) {
      strapi.log.warn('user-progress-automation: course_unassigned failed: %s', e?.message || e);
    }
  }
}

/**
 * Existing assignment edit/republish: compare previous published users vs new list.
 * - Removed users → course_unassigned
 * - Newly added users → course_assigned + user-progress create
 * Does NOT send due_date_changed (that lives on user-progress).
 */
async function handleExistingAssignmentUserChanges(strapi, result, params = {}) {
  const dedupeKey = String(result?.documentId || result?.id || '');
  if (dedupeKey && isAssignmentDiffHandled(dedupeKey)) {
    strapi.log.info(
      'user-progress-automation: skip duplicate assignment user-diff for %s',
      dedupeKey
    );
    return;
  }
  if (dedupeKey) markAssignmentDiffHandled(dedupeKey);

  const assignmentId = result?.id ?? result?.documentId;
  let payload = null;
  if (params?.data) {
    payload = await getAssignedUserIdsFromParams(strapi, params, result);
  }
  if (!payload || !payload.userIds || payload.userIds.length === 0) {
    if (assignmentId != null) {
      await new Promise((r) => setTimeout(r, 200));
      payload = await getAssignedUserIds(strapi, assignmentId);
    }
  }

  const nextUserIds = [...new Set((payload?.userIds || []).map(Number).filter(Boolean))];
  const prevUserIds = await getPreviousPublishedAssignmentUserIds(strapi, result);
  const nextSet = new Set(nextUserIds);
  const prevSet = new Set(prevUserIds);
  const removedUserIds = prevUserIds.filter((id) => !nextSet.has(Number(id)));
  const addedUserIds = nextUserIds.filter((id) => !prevSet.has(Number(id)));

  const courseIds =
    Array.isArray(payload?.courseIds) && payload.courseIds.length > 0
      ? [...new Set(payload.courseIds)]
      : payload?.courseId
        ? [payload.courseId]
        : [];

  strapi.log.info(
    'user-progress-automation: existing assignment user diff documentId=%s prev=%d next=%d removed=%d added=%d',
    result?.documentId ?? 'n/a',
    prevUserIds.length,
    nextUserIds.length,
    removedUserIds.length,
    addedUserIds.length
  );

  // Without a previous baseline, every remaining user looks "added" and would wrongly
  // get course_reassigned. Document middleware already handled the real remove/add diff.
  if (prevUserIds.length === 0) {
    strapi.log.info(
      'user-progress-automation: skip existing-assignment add/reassign — empty previous user baseline (documentId=%s)',
      result?.documentId ?? 'n/a'
    );
    return;
  }

  if (removedUserIds.length > 0 && courseIds.length > 0) {
    await sendCourseUnassignedNotifications(strapi, removedUserIds, courseIds);
  }

  if (addedUserIds.length === 0 || courseIds.length === 0) return;

  const due_date = payload?.due_date ?? result?.due_date;
  const targetType = payload?.targetType ?? result?.assignment_target_type;
  const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };

  for (const rawCourseId of courseIds) {
    const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
    if (!numericCourseId) continue;

    const {
      assignedUserIds: newUserIds,
      reassignedUserIds,
      progressNewIds,
    } = await classifyNewlyListedUsersForNotifications(
      strapi,
      addedUserIds,
      numericCourseId
    );
    const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);

    if (newUserIds.length > 0) {
      await notifyAssignmentUsersForCourse(strapi, {
        type: 'course_assigned',
        title: 'Course Assigned',
        message: `"${courseTitle}" has been assigned to you.`,
        rawCourseId,
        userIds: newUserIds,
        meta: { assignedBy: null, level: levelMap[targetType] || targetType },
        targetType,
        excludeCompletedUsers: true,
      });
    }

    if (reassignedUserIds.length > 0) {
      await notifyAssignmentUsersForCourse(strapi, {
        type: 'course_reassigned',
        title: 'Course Reassigned',
        message: `"${courseTitle}" has been reassigned to you.`,
        rawCourseId,
        userIds: reassignedUserIds,
        meta: { assignedBy: null, level: levelMap[targetType] || targetType },
        targetType,
        excludeCompletedUsers: false,
      });
      await reuseExistingUserProgressOnReassign(strapi, numericCourseId, reassignedUserIds);
    }

    if (progressNewIds.length > 0) {
      await createUserProgressEntries(strapi, numericCourseId, progressNewIds, due_date);
    }
  }
}

/**
 * Document Service hook for course-assignment update + publish (Content Manager).
 *
 * Critical: CM removes users on draft UPDATE (relation links change immediately).
 * By PUBLISH time the published row may already match the new list, so we must
 * snapshot assignees BEFORE update and notify on publish (or publish-status update).
 */
async function handleCourseAssignmentDocumentMiddleware(strapi, context, next) {
  if (_creatingSubEntries) return await next();

  const action = context?.action;
  if (!['update', 'publish'].includes(action)) {
    return await next();
  }

  const documentId = context.params?.documentId
    ? String(context.params.documentId)
    : null;
  const data = context.params?.data;

  const disconnectedIds = extractRelationIds(data?.individual_user?.disconnect)
    .map(Number)
    .filter(Boolean);

  // Snapshot BEFORE mutation — update rewrites relation join rows immediately.
  if (documentId && !_prevAssignmentUsersByDocId.has(documentId)) {
    try {
      let row = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
        where: {
          documentId,
          publishedAt: { $notNull: true },
        },
        select: ['id'],
        orderBy: { updatedAt: 'desc' },
      });
      if (!row) {
        row = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
          where: { documentId },
          select: ['id'],
          orderBy: { updatedAt: 'desc' },
        });
      }
      if (row?.id) {
        const payload = await getAssignedUserIds(strapi, row.id);
        const snap = {
          userIds: [...new Set((payload?.userIds || []).map(Number).filter(Boolean))],
          courseIds: (Array.isArray(payload?.courseIds) && payload.courseIds.length > 0
            ? payload.courseIds
            : payload?.courseId
              ? [payload.courseId]
              : []
          ).filter(Boolean),
          pendingRemoved: [],
        };
        _prevAssignmentUsersByDocId.set(documentId, snap);
        setTimeout(() => _prevAssignmentUsersByDocId.delete(documentId), 120000);
        strapi.log.info(
          'user-progress-automation: captured assignment users before %s doc=%s users=%d',
          action,
          documentId,
          snap.userIds.length
        );
      }
    } catch (e) {
      strapi.log.warn(
        'user-progress-automation: failed capturing assignment users before %s: %s',
        action,
        e?.message || e
      );
    }
  }

  if (documentId && disconnectedIds.length) {
    const snap = _prevAssignmentUsersByDocId.get(documentId) || {
      userIds: [],
      courseIds: [],
      pendingRemoved: [],
    };
    snap.pendingRemoved = [...new Set([...(snap.pendingRemoved || []), ...disconnectedIds])];
    _prevAssignmentUsersByDocId.set(documentId, snap);
    strapi.log.info(
      'user-progress-automation: recorded disconnects on %s doc=%s ids=[%s]',
      action,
      documentId,
      disconnectedIds.join(',')
    );
  }

  // Claim ownership ONLY for existing-assignment edit/republish (prior user baseline).
  const preSnap = documentId ? _prevAssignmentUsersByDocId.get(documentId) : null;
  const middlewareOwnsUserDiff =
    Boolean(documentId)
    && (action === 'publish' || context.params?.status === 'published')
    && Array.isArray(preSnap?.userIds)
    && preSnap.userIds.length > 0;
  if (middlewareOwnsUserDiff) {
    markAssignmentDiffHandled(documentId);
  }

  const result = await next();
  const resultDoc = result?.document ?? result;

  const isPublishedResult =
    action === 'publish'
    || context.params?.status === 'published'
    || resultDoc?.publishedAt != null
    || resultDoc?.published_at != null;

  // Draft-only save: keep snapshot for publish; do not notify yet.
  if (!isPublishedResult) {
    return result;
  }

  if (documentId && !middlewareOwnsUserDiff && isAssignmentDiffHandled(documentId)) {
    strapi.log.info(
      'user-progress-automation: skip document middleware user-diff — lifecycle already handled (documentId=%s)',
      documentId
    );
    _prevAssignmentUsersByDocId.delete(documentId);
    return result;
  }

  const snap = documentId ? _prevAssignmentUsersByDocId.get(documentId) : null;
  const previousUserIds = [...new Set((snap?.userIds || []).map(Number).filter(Boolean))];

  let nextUserIds = [];
  let courseIds = [...(snap?.courseIds || [])];
  try {
    const lookupId = resultDoc?.id ?? documentId;
    if (lookupId != null) {
      await new Promise((r) => setTimeout(r, 150));
      const payload = await getAssignedUserIds(strapi, lookupId);
      nextUserIds = [...new Set((payload?.userIds || []).map(Number).filter(Boolean))];
      if (Array.isArray(payload?.courseIds) && payload.courseIds.length > 0) {
        courseIds = payload.courseIds;
      } else if (payload?.courseId) {
        courseIds = [payload.courseId];
      }
    }
  } catch (e) {
    strapi.log.warn(
      'user-progress-automation: failed loading post-%s users: %s',
      action,
      e?.message || e
    );
  }

  const nextSet = new Set(nextUserIds);
  const prevSet = new Set(previousUserIds);
  const removedUserIds = [
    ...new Set([
      ...previousUserIds.filter((id) => !nextSet.has(Number(id))),
      ...(snap?.pendingRemoved || []).map(Number).filter(Boolean),
      ...disconnectedIds,
    ]),
  ];
  // Only treat users as "added" when we had a real previous snapshot.
  // Empty prev + non-empty next would mark every remaining user as added → false reassigns.
  const addedUserIds = previousUserIds.length > 0
    ? nextUserIds.filter((id) => !prevSet.has(Number(id)))
    : extractRelationIds(data?.individual_user?.connect)
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0 && nextSet.has(id));

  strapi.log.info(
    'user-progress-automation: assignment %s user-diff doc=%s prev=%d next=%d removed=%d added=%d courses=%s',
    action,
    documentId || 'n/a',
    previousUserIds.length,
    nextUserIds.length,
    removedUserIds.length,
    addedUserIds.length,
    JSON.stringify(courseIds)
  );

  if (removedUserIds.length > 0 && courseIds.length > 0) {
    await sendCourseUnassignedNotifications(strapi, removedUserIds, courseIds);
  } else if (removedUserIds.length > 0 && courseIds.length === 0) {
    strapi.log.warn(
      'user-progress-automation: had removed users but no courseIds — cannot send course_unassigned'
    );
  }

  if (addedUserIds.length > 0 && courseIds.length > 0) {
    const due_date = data?.due_date ?? resultDoc?.due_date;
    const targetType = data?.assignment_target_type ?? resultDoc?.assignment_target_type;
    const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };
    for (const rawCourseId of courseIds) {
      const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
      if (!numericCourseId) continue;
      const {
        assignedUserIds: newUserIds,
        reassignedUserIds,
        progressNewIds,
      } = await classifyNewlyListedUsersForNotifications(
        strapi,
        addedUserIds,
        numericCourseId
      );
      const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);

      if (newUserIds.length > 0) {
        await notifyAssignmentUsersForCourse(strapi, {
          type: 'course_assigned',
          title: 'Course Assigned',
          message: `"${courseTitle}" has been assigned to you.`,
          rawCourseId,
          userIds: newUserIds,
          meta: { assignedBy: null, level: levelMap[targetType] || targetType },
          targetType,
          excludeCompletedUsers: true,
        });
      }

      if (reassignedUserIds.length > 0) {
        await notifyAssignmentUsersForCourse(strapi, {
          type: 'course_reassigned',
          title: 'Course Reassigned',
          message: `"${courseTitle}" has been reassigned to you.`,
          rawCourseId,
          userIds: reassignedUserIds,
          meta: { assignedBy: null, level: levelMap[targetType] || targetType },
          targetType,
          excludeCompletedUsers: false,
        });
        await reuseExistingUserProgressOnReassign(strapi, numericCourseId, reassignedUserIds);
      }

      if (progressNewIds.length > 0) {
        await createUserProgressEntries(strapi, numericCourseId, progressNewIds, due_date);
      }
    }
  }

  // Mark handled so course-assignment afterCreate republication does not re-diff and
  // blast course_reassigned to every remaining user.
  if (documentId) {
    markAssignmentDiffHandled(documentId);
    _prevAssignmentUsersByDocId.delete(documentId);
  }
  return result;
}

async function filterUsersNotCompleted(strapi, userIds, numericCourseId) {
  const normalizedIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!normalizedIds.length || !numericCourseId) return [];

  try {
    const completedRows = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: {
        course: Number(numericCourseId),
        user: { $in: normalizedIds },
        progress_status: 'Completed',
      },
      select: ['id'],
      populate: { user: { select: ['id'] } },
    });
    const completedSet = new Set(
      (completedRows || [])
        .map((row) => row.user?.id ?? row.user)
        .filter((id) => id != null)
        .map(Number)
    );
    return normalizedIds.filter((id) => !completedSet.has(id));
  } catch (e) {
    strapi.log.warn('user-progress-automation: filterUsersNotCompleted failed:', e?.message || e);
    return normalizedIds;
  }
}

/**
 * Split userIds by whether they already have a user-progress record for this course.
 * Used for progress-row creation only — NOT for assign vs reassign notification type.
 */
async function splitNewAndExistingUsers(strapi, userIds, numericCourseId) {
  const normalizedIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!normalizedIds.length || !numericCourseId) {
    return { newUserIds: normalizedIds, existingUserIds: [] };
  }

  try {
    const existingSet = new Set();
    for (const userId of normalizedIds) {
      const existing = await findExistingUserProgress(strapi, userId, numericCourseId);
      if (existing) existingSet.add(Number(userId));
    }

    const newUserIds = normalizedIds.filter((id) => !existingSet.has(id));
    const existingUserIds = normalizedIds.filter((id) => existingSet.has(id));

    strapi.log.info(
      'user-progress-automation: splitNewAndExistingUsers courseId=%s total=%d new=%d existing=%d',
      numericCourseId,
      normalizedIds.length,
      newUserIds.length,
      existingUserIds.length
    );

    return { newUserIds, existingUserIds };
  } catch (e) {
    strapi.log.warn('user-progress-automation: splitNewAndExistingUsers failed, treating all as new:', e?.message || e);
    return { newUserIds: normalizedIds, existingUserIds: [] };
  }
}

/**
 * Classify newly listed / re-added users for enrollment notifications — per user.
 * Progress rows are created only for first-time assigns that lack progress.
 * Reassigned users must reuse their existing user-progress (never create a new one).
 */
async function classifyNewlyListedUsersForNotifications(strapi, userIds, numericCourseId) {
  const normalizedIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!normalizedIds.length || !numericCourseId) {
    return { assignedUserIds: normalizedIds, reassignedUserIds: [], progressNewIds: normalizedIds };
  }

  const reassignedUserIds = [];
  const assignedUserIds = [];

  for (const uid of normalizedIds) {
    const isReassign =
      wasRecentlyUnassignedFromCourse(numericCourseId, uid)
      || (await isLatestEnrollmentUnassigned(strapi, uid, numericCourseId));
    if (isReassign) reassignedUserIds.push(uid);
    else assignedUserIds.push(uid);
  }

  // Only first-time assigns may get a new progress row.
  const { newUserIds: progressNewIds } = await splitNewAndExistingUsers(
    strapi,
    assignedUserIds,
    numericCourseId
  );

  strapi.log.info(
    'user-progress-automation: classifyNewlyListed courseId=%s assigned=[%s] reassigned=[%s] needsProgress=%d',
    numericCourseId,
    assignedUserIds.join(','),
    reassignedUserIds.join(','),
    progressNewIds.length
  );

  return { assignedUserIds, reassignedUserIds, progressNewIds };
}

function notificationMetaMatchesCourse(meta, numericCourseId, courseDocumentId = null) {
  if (!meta || numericCourseId == null) return false;
  const metaCourse = meta.courseId ?? meta.course_id;
  if (metaCourse == null) return false;
  const metaKey = String(metaCourse);
  const metaNum = Number(metaCourse);
  const courseKey = String(numericCourseId);
  if (metaKey === courseKey) return true;
  if (Number.isFinite(metaNum) && metaNum === Number(numericCourseId)) return true;
  if (courseDocumentId && metaKey === String(courseDocumentId)) return true;
  return false;
}

async function isLatestEnrollmentUnassigned(strapi, userId, numericCourseId) {
  const uid = Number(userId);
  const cid = Number(numericCourseId);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(cid) || cid <= 0) return false;

  let courseDocumentId = null;
  try {
    const course = await strapi.db.query(COURSE_UID).findOne({
      where: { id: cid },
      select: ['documentId'],
    });
    courseDocumentId = course?.documentId ? String(course.documentId) : null;
  } catch (_) { /* ignore */ }

  try {
    const rows = await strapi.db.query('api::notification.notification').findMany({
      where: {
        toUser: { id: uid },
        type: { $in: ['course_unassigned', 'course_assigned', 'course_reassigned'] },
      },
      select: ['id', 'type', 'meta', 'createdAt'],
      orderBy: { createdAt: 'desc' },
      limit: 40,
    });

    for (const row of rows || []) {
      if (!notificationMetaMatchesCourse(row?.meta, cid, courseDocumentId)) continue;
      return row.type === 'course_unassigned';
    }
    return false;
  } catch (e) {
    strapi.log.warn(
      'user-progress-automation: isLatestEnrollmentUnassigned failed user=%s course=%s: %s',
      uid,
      cid,
      e?.message || e
    );
    return false;
  }
}

async function findUsersWithLatestUnassignedNotif(strapi, userIds, numericCourseId) {
  const normalizedIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!normalizedIds.length || !numericCourseId) return [];

  const out = [];
  for (const uid of normalizedIds) {
    if (await isLatestEnrollmentUnassigned(strapi, uid, numericCourseId)) {
      out.push(uid);
    }
  }
  return out;
}

async function reconcileAssignmentUserDiff(strapi, oldUserIds, newUserIds, numericCourseId) {
  const base = diffAssignmentUserSets(oldUserIds, newUserIds);
  const continuedIds = base.continuedUserIds || [];
  if (!continuedIds.length) return base;

  const openUnassignIds = await findUsersWithLatestUnassignedNotif(
    strapi,
    continuedIds,
    numericCourseId
  );
  const openUnassignSet = new Set(openUnassignIds.map(Number));

  const { newUserIds: phantomContinuedIds, existingUserIds: continuedWithProgress } =
    await splitNewAndExistingUsers(strapi, continuedIds, numericCourseId);

  const readdFromStaleIds = continuedWithProgress.filter((id) => openUnassignSet.has(Number(id)));
  const readdSet = new Set(readdFromStaleIds.map(Number));

  const continuedUserIds = continuedWithProgress.filter(
    (id) => !readdSet.has(Number(id))
  );
  const newlyListedUserIds = [
    ...new Set([
      ...base.newlyListedUserIds,
      ...phantomContinuedIds,
      ...readdFromStaleIds,
    ]),
  ];

  strapi.log.info(
    'user-progress-automation: reconcile membership courseId=%s continued=%d→%d readdStale=%d phantom=%d newlyListed=%d→%d',
    numericCourseId,
    continuedIds.length,
    continuedUserIds.length,
    readdFromStaleIds.length,
    phantomContinuedIds.length,
    base.newlyListedUserIds.length,
    newlyListedUserIds.length
  );

  return {
    unassignedUserIds: base.unassignedUserIds,
    newlyListedUserIds,
    continuedUserIds,
  };
}

async function resolveCourseTitleForNotification(strapi, rawCourseId) {
  let courseTitle = 'A new course';
  try {
    const resolvedId = typeof rawCourseId === 'string' && isNaN(Number(rawCourseId)) ? null : Number(rawCourseId);
    const course = await strapi.db.query(COURSE_UID).findOne({
      where: resolvedId ? { id: resolvedId } : { documentId: rawCourseId },
      select: ['title'],
    });
    if (course?.title) courseTitle = course.title;
  } catch { /* keep default */ }
  return courseTitle;
}

async function notifyAssignmentUsersForCourse(strapi, {
  type,
  title,
  message,
  rawCourseId,
  userIds,
  meta = {},
  targetType = null,
  excludeCompletedUsers = true,
}) {
  const notifUtil = strapi.utils?.notification;
  if (!notifUtil || !rawCourseId || !Array.isArray(userIds) || userIds.length === 0) return;

  const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
  if (!numericCourseId) return;

  let recipientUserIds = excludeCompletedUsers
    ? await filterUsersNotCompleted(strapi, userIds, numericCourseId)
    : [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];

  recipientUserIds = claimAssignmentNotificationRecipients(type, numericCourseId, recipientUserIds);
  if (!recipientUserIds.length) {
    strapi.log.info(
      'user-progress-automation: skip %s — no eligible/unclaimed users for courseId=%s',
      type,
      numericCourseId
    );
    return;
  }

  const usersWithEmail = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: { id: { $in: recipientUserIds } },
    select: ['id', 'email'],
  });
  if (!usersWithEmail.length) return;

  const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };
  const enrichedMeta = {
    ...meta,
    courseId: numericCourseId,
    ...(targetType ? { level: levelMap[targetType] || targetType } : {}),
  };

  const emailEnabled = typeof notifUtil.isEmailEnabled === 'function' ? notifUtil.isEmailEnabled() : false;
  await notifUtil.sendNotification(
    type,
    title,
    message,
    usersWithEmail,
    enrichedMeta,
    [],
    { sendEmail: emailEnabled, sendSocket: true }
  );
}

async function sendDueDateChangedNotifications(strapi, result, payload) {
  const { courseId, courseIds, userIds, due_date, targetType } = payload || {};
  if (!userIds?.length) return;

  const allCourseIds = (Array.isArray(courseIds) && courseIds.length > 0) ? [...new Set(courseIds)] : [courseId];
  const dueDateDisplay = formatDueDateForDisplay(due_date ?? result?.due_date);

  for (const rawCourseId of allCourseIds) {
    if (!rawCourseId) continue;
    const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);
    const message = dueDateDisplay
      ? `The due date for "${courseTitle}" has been updated to ${dueDateDisplay}.`
      : `The due date for "${courseTitle}" has been updated.`;

    await notifyAssignmentUsersForCourse(strapi, {
      type: 'due_date_changed',
      title: 'Course Due Date Updated',
      message,
      rawCourseId,
      userIds,
      meta: {
        dueDate: dueDateDisplay,
        newDueDate: dueDateDisplay,
        assignedBy: null,
      },
      targetType,
    });
  }
}

function getUserId(user) {
  if (!user) return null;
  return user.id ?? user.documentId ?? user.document_id;
}

function getCourseId(course) {
  if (course == null) return null;
  if (Array.isArray(course)) return course.length > 0 ? getCourseId(course[0]) : null;
  if (typeof course === 'number' && !Number.isNaN(course)) return course;
  if (typeof course === 'string' && course.length > 0) return course;
  return course.id ?? course.documentId ?? course.document_id ?? null;
}

function getAllCourseIds(courses) {
  if (courses == null) return [];
  if (Array.isArray(courses)) {
    return courses.map(getCourseId).filter(Boolean);
  }
  const single = getCourseId(courses);
  return single ? [single] : [];
}

function extractRelationIds(raw) {
  if (raw == null) return [];
  if (typeof raw === 'number') return [raw];
  if (typeof raw === 'string') return raw.length > 0 ? [raw] : [];
  if (Array.isArray(raw)) {
    return raw.map((item) => (item && typeof item === 'object' ? (item.id ?? item.documentId) : item)).filter(Boolean);
  }
  if (typeof raw === 'object') {
    const arr = Array.isArray(raw.connect) ? raw.connect : Array.isArray(raw.set) ? raw.set : (raw.id != null ? [raw] : []);
    return arr.map((item) => (item && typeof item === 'object' ? (item.id ?? item.documentId) : item)).filter(Boolean);
  }
  return [];
}

const COURSE_UID = 'api::course.course';
async function resolveCourseIdForDb(strapi, courseId) {
  if (courseId == null) return null;
  const n = Number(courseId);
  if (!Number.isNaN(n) && n > 0) return n;
  if (typeof courseId === 'string' && courseId.length > 10) {
    const row = await strapi.db.query(COURSE_UID).findOne({ where: { documentId: courseId }, select: ['id'] });
    return row?.id ?? null;
  }
  return courseId;
}

function normalizeCompanyName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (lower === 'aia') return 'AIA';
  if (lower === 'vega') return 'Vega';
  return String(name || '').trim();
}

function extractCompanyNamesFromEntity(raw) {
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return [...new Set(items.map((item) => item?.name ?? item?.attributes?.name).filter(Boolean).map(normalizeCompanyName))];
}

async function resolveCompanyNames(strapi, rawCompany, fallbackCompany) {
  const relationIds = extractRelationIds(rawCompany);
  const numericIds = relationIds
    .filter((value) => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(String(value))))
    .map(Number);
  const docIds = relationIds.filter((value) => typeof value === 'string' && value.length > 10);

  let companies = [];
  if (numericIds.length > 0) {
    const byId = await strapi.db.query('api::company.company').findMany({
      where: { id: { $in: numericIds } },
      select: ['name'],
    });
    companies = companies.concat(byId || []);
  }
  if (docIds.length > 0) {
    const byDocId = await strapi.db.query('api::company.company').findMany({
      where: { documentId: { $in: docIds } },
      select: ['name'],
    });
    (byDocId || []).forEach((company) => {
      if (company?.name && !companies.some((item) => item?.name === company.name)) companies.push(company);
    });
  }

  const names = companies.map((company) => normalizeCompanyName(company?.name)).filter(Boolean);
  if (names.length > 0) return [...new Set(names)];
  return extractCompanyNamesFromEntity(fallbackCompany);
}

function scopeUserWhere(where, companyNames) {
  if (!Array.isArray(companyNames) || companyNames.length === 0) return where;
  if (companyNames.length === 1) {
    return { ...where, company: companyNames[0] };
  }
  return {
    $and: [
      where,
      { $or: companyNames.map((name) => ({ company: name })) },
    ],
  };
}

async function getAssignedUserIdsFromParams(strapi, params, result) {
  const data = params?.data;
  if (!data) {
    strapi.log.debug('user-progress-automation: getAssignedUserIdsFromParams no params.data');
    return null;
  }
  const targetType = data.assignment_target_type || 'Company';
  const doc = result?.document ?? result;
  let courseId = getCourseId(data.courses) ?? getCourseId(data.course) ??
    getCourseId(doc?.courses) ?? getCourseId(doc?.course) ??
    getCourseId(result?.courses) ?? getCourseId(result?.course) ??
    doc?.course_id ?? result?.course_id;
  if (courseId == null) {
    const courseRaw = data.courses ?? data.course;
    if (courseRaw != null) {
      const ids = extractRelationIds(courseRaw);
      if (ids.length > 0) courseId = ids[0];
    }
  }
  let courseIds = [];
  {
    const courseRaw = data.courses ?? data.course;
    if (courseRaw != null) {
      const relIds = extractRelationIds(courseRaw);
      if (relIds.length > 0) courseIds = relIds;
    }
    if (courseIds.length === 0) {
      const fromResult = getAllCourseIds(doc?.courses) || getAllCourseIds(doc?.course) ||
        getAllCourseIds(result?.courses) || getAllCourseIds(result?.course);
      if (fromResult && fromResult.length > 0) courseIds = fromResult;
    }
    if (courseIds.length === 0 && courseId) courseIds = [courseId];
    if (!courseId && courseIds.length > 0) courseId = courseIds[0];
  }

  if (!courseId) {
    strapi.log.warn('user-progress-automation: getAssignedUserIdsFromParams no courseId', { hasCourseInData: !!data.course, hasCourseInResult: !!result?.course });
    return null;
  }

  const companyNames = await resolveCompanyNames(strapi, data.company ?? data.companies, result?.company ?? result?.companies);

  let userIds = [];
  if (targetType === 'Individual') {
    const raw = data.individual_user ?? data.individual_user_id;
    const extracted = extractRelationIds(raw);
    const numericIds = [];
    const docIds = [];
    for (const id of extracted) {
      if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(String(id)))) {
        numericIds.push(Number(id));
      } else if (typeof id === 'string' && id.length > 0) {
        docIds.push(id);
      }
    }
    if (docIds.length > 0) {
      try {
        const resolved = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { documentId: { $in: docIds } },
          select: ['id'],
        });
        (resolved || []).forEach((u) => { if (u.id) numericIds.push(u.id); });
      } catch (e) {
        strapi.log.warn('user-progress-automation: failed to resolve user documentIds', e?.message || e);
      }
    }

    if (companyNames.length > 0 && numericIds.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ id: { $in: [...new Set(numericIds)] } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    } else {
      userIds = [...new Set(numericIds)];
    }
  } else if (targetType === 'Department') {
    const ids = extractRelationIds(data.departments ?? data.departments_id);
    if (ids.length > 0) {
      const depts = await strapi.db.query('api::department.department').findMany({
        where: { id: { $in: ids.map(Number) } },
        select: ['name'],
      });
      const deptNames = (depts || []).map((d) => d.name).filter(Boolean);
      if (deptNames.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: scopeUserWhere({ department: { $in: deptNames } }, companyNames),
          select: ['id'],
        });
        userIds = (users || []).map((u) => u.id).filter(Boolean);
      }
    }
  } else if (targetType === 'Location') {
    const ids = extractRelationIds(data.work_locations ?? data.unit_locations ?? data.work_locations_id ?? data.unit_locations_id);
    if (ids.length > 0) {
      const locs = await strapi.db.query('api::work-location.work-location').findMany({
        where: { id: { $in: ids.filter((x) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number) } },
        select: ['name'],
      });
      const locationNames = (locs || []).map((l) => l.name).filter(Boolean);
      if (locationNames.length > 0) {
        const includeVega = companyNames.length === 0 || companyNames.includes('Vega');
        const includeAia = companyNames.length === 0 || companyNames.includes('AIA');
        const userLists = await Promise.all([
          includeVega
            ? strapi.db.query('plugin::users-permissions.user').findMany({
              where: { company: 'Vega', working_location: { $in: locationNames } },
              select: ['id'],
            })
            : Promise.resolve([]),
          includeAia
            ? strapi.db.query('plugin::users-permissions.user').findMany({
              where: { company: 'AIA', branch: { $in: locationNames } },
              select: ['id'],
            })
            : Promise.resolve([]),
        ]);
        const idSet = new Set();
        userLists.flat().forEach((u) => { if (u?.id) idSet.add(u.id); });
        userIds = [...idSet];
      }
    }
  } else if (targetType === 'Company') {
    // No target type selected (or explicitly Company): assign to all users of the selected company
    if (companyNames.length > 0) {
      for (const name of companyNames) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { company: name },
          select: ['id'],
        });
        (users || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
      }
    } else {
      strapi.log.warn('user-progress-automation: Company fallback but no company resolved — skipping');
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIdsFromParams', { targetType, userIdsCount: userIds.length, courseIdsCount: courseIds.length });
  return {
    courseId,
    courseIds,
    userIds,
    due_date: data.due_date ?? result?.due_date,
    active: data.active !== false,
    targetType,
    company: data.company ?? result?.company,
  };
}

async function loadAssignment(strapi, assignmentId) {
  if (assignmentId == null || assignmentId === '') return null;
  let assignment = null;
  const isNumeric = typeof assignmentId === 'number' || (typeof assignmentId === 'string' && /^\d+$/.test(assignmentId));
  if (isNumeric) {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { id: Number(assignmentId) },
      populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { documentId: assignmentId },
      populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    try {
      const doc = await strapi.documents(COURSE_ASSIGNMENT_UID).findOne({
        documentId: assignmentId,
        populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
      });
      if (doc) assignment = doc;
    } catch (_) {}
  }
  return assignment;
}

async function getAssignedUserIds(strapi, assignmentId) {
  const assignment = await loadAssignment(strapi, assignmentId);
  if (!assignment) {
    strapi.log.warn('user-progress-automation: assignment not found', { assignmentId });
    return { courseId: null, userIds: [], due_date: null, active: true, targetType: null };
  }
  const coursesField = assignment.courses ?? assignment.course;
  if (!coursesField) {
    strapi.log.warn('user-progress-automation: assignment has no course', { assignmentId });
    return { courseId: null, courseIds: [], userIds: [], due_date: null, active: true, targetType: null };
  }
  const courseId = getCourseId(coursesField);
  const courseIds = getAllCourseIds(coursesField);
  if (!courseId) return { courseId: null, courseIds: [], userIds: [], due_date: assignment.due_date, active: assignment.active, targetType: assignment.assignment_target_type };

  const targetType = assignment.assignment_target_type || 'Company';
  const companyNames = await resolveCompanyNames(strapi, assignment.company ?? assignment.companies, assignment.company ?? assignment.companies);
  let userIds = [];

  if (targetType === 'Individual' && Array.isArray(assignment.individual_user)) {
    const extracted = assignment.individual_user.map(getUserId).filter(Boolean);
    const numericIds = [];
    const docIds = [];
    for (const id of extracted) {
      if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(String(id)))) {
        numericIds.push(Number(id));
      } else if (typeof id === 'string' && id.length > 0) {
        docIds.push(id);
      }
    }
    if (docIds.length > 0) {
      try {
        const resolved = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { documentId: { $in: docIds } },
          select: ['id'],
        });
        (resolved || []).forEach((u) => { if (u?.id) numericIds.push(Number(u.id)); });
      } catch (e) {
        strapi.log.warn('user-progress-automation: failed resolving individual_user documentIds: %s', e?.message || e);
      }
    }
    userIds = [...new Set(numericIds.filter(Boolean))];
    if (companyNames.length > 0 && userIds.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ id: { $in: userIds } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  } else if (targetType === 'Department' && Array.isArray(assignment.departments)) {
    const deptNames = assignment.departments.map((d) => d?.name).filter(Boolean);
    if (deptNames.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ department: { $in: deptNames } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  } else if (targetType === 'Location' && Array.isArray(assignment.work_locations ?? assignment.unit_locations) && (assignment.work_locations ?? assignment.unit_locations).length > 0) {
    const locationNames = (assignment.work_locations ?? assignment.unit_locations).map((l) => l?.name).filter(Boolean);
    if (locationNames.length > 0) {
      const includeVega = companyNames.length === 0 || companyNames.includes('Vega');
      const includeAia = companyNames.length === 0 || companyNames.includes('AIA');
      const userLists = await Promise.all([
        includeVega
          ? strapi.db.query('plugin::users-permissions.user').findMany({
            where: { company: 'Vega', working_location: { $in: locationNames } },
            select: ['id'],
          })
          : Promise.resolve([]),
        includeAia
          ? strapi.db.query('plugin::users-permissions.user').findMany({
            where: { company: 'AIA', branch: { $in: locationNames } },
            select: ['id'],
          })
          : Promise.resolve([]),
      ]);
      const idSet = new Set();
      userLists.flat().forEach((u) => { if (u?.id) idSet.add(u.id); });
      userIds = [...idSet];
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIds', { assignmentId, targetType, userIdsCount: userIds.length });
  // --- Company / no-target-type fallback already handled by targetType defaulting to 'Company' above.
  // The Individual / Department / Location branches won't match, so we add the Company branch here. ---
  if (userIds.length === 0 && targetType === 'Company' && companyNames.length > 0) {
    for (const name of companyNames) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { company: name },
        select: ['id'],
      });
      (users || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIds (final)', { assignmentId, targetType, userIdsCount: userIds.length, courseIdsCount: courseIds.length });
  return {
    courseId,
    courseIds,
    userIds,
    due_date: assignment.due_date,
    active: assignment.active,
    targetType,
    company: assignment.company,
  };
}

async function createCourseAssignmentEntries(strapi, courseId, userIds, dueDate, active, companyRaw) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  const due = dueDate instanceof Date ? dueDate : (dueDate ? new Date(dueDate) : new Date());
  const dueValue = due.toISOString().slice(0, 10);
  const activeValue = active === 'unpublished' ? 'unpublished' : 'published';
  
  const existingByUserId = new Map();
  try {
    const existing = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: { assignment_target_type: 'Individual', courses: { id: Number(courseId) } },
      populate: { individual_user: true },
      limit: 10000,
    });
    (existing || []).forEach((a) => {
      const users = Array.isArray(a?.individual_user) ? a.individual_user : (a?.individual_user ? [a.individual_user] : []);
      users.forEach((u) => {
        const keys = [];
        if (u?.id != null) keys.push(String(u.id));
        if (u?.documentId != null) keys.push(String(u.documentId));

        keys.forEach((key) => {
          const bucket = existingByUserId.get(key);
          if (bucket) {
            bucket.push(a);
          } else {
            existingByUserId.set(key, [a]);
          }
        });
      });
    });
  } catch (_) {}
  
  const docService = strapi.documents(COURSE_ASSIGNMENT_UID);
  let created = 0;
  let updated = 0;
  _creatingSubEntries = true;
  try {
    for (const userId of userIds) {
      const existingAssignments = existingByUserId.get(String(userId)) || [];
      
      if (existingAssignments.length > 0) {
        // Existing user: preserve their original due_date.
        // Only re-activate the record if it was previously unpublished — do NOT touch due_date.
        try {
          const seen = new Set();
          for (const existingAssignment of existingAssignments) {
            const key = existingAssignment?.documentId
              ? `doc:${existingAssignment.documentId}`
              : existingAssignment?.id != null
                ? `id:${existingAssignment.id}`
                : null;
            if (!key || seen.has(key)) continue;
            seen.add(key);

            // Only write back if the active status actually needs to change
            if (existingAssignment.active !== activeValue) {
              if (existingAssignment?.documentId) {
                await docService.update({
                  documentId: existingAssignment.documentId,
                  data: { active: activeValue },
                  status: 'published',
                });
              } else if (existingAssignment?.id != null) {
                await strapi.db.query(COURSE_ASSIGNMENT_UID).update({
                  where: { id: existingAssignment.id },
                  data: { active: activeValue },
                });
              }
            }
          }
          updated++;
          strapi.log.info(
            'user-progress-automation: preserved due_date for existing course-assignment (userId=%s, courseId=%s)',
            userId,
            courseId
          );
        } catch (e) {
          strapi.log.warn('Failed to update active status for course-assignment (userId=%s):', userId, e?.message || String(e));
        }
        continue;
      }
      
      // Create new entry if user doesn't have this course yet
      try {
        const companyId = companyRaw?.id ?? (Array.isArray(companyRaw?.connect) ? companyRaw.connect[0]?.id : null);
        await docService.create({
          data: {
            assignment_target_type: 'Individual',
            courses: { connect: [{ id: Number(courseId) }] },
            due_date: dueValue,
            active: activeValue,
            individual_user: [userId],
            ...(companyId ? { company: { connect: [{ id: companyId }] } } : {}),
          },
          status: 'published',
        });
        created++;
      } catch (e) {
        strapi.log.warn('createCourseAssignmentEntries failed (userId=%s):', userId, e?.message || String(e));
      }
    }
  } finally {
    _creatingSubEntries = false;
  }
  if (created > 0 || updated > 0) {
    strapi.log.info(
      'user-progress-automation: created %d individual course-assignment entries, reactivated %d existing entries (due_dates preserved)',
      created,
      updated
    );
  }
}

/**
 * Find any existing user-progress for user+course (draft or published).
 * Documents findFirst alone often misses rows → duplicate Not_started on re-assign.
 */
async function findExistingUserProgress(strapi, userId, courseId) {
  const uid = Number(userId);
  const cid = Number(courseId);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(cid) || cid <= 0) return null;

  const matchesUserCourse = (row) => {
    if (!row) return false;
    const rowUser = Number(row.user?.id ?? row.user);
    const rowCourse = Number(row.course?.id ?? row.course);
    return rowUser === uid && rowCourse === cid;
  };

  const tryQuery = async (where) => {
    try {
      return await strapi.db.query(USER_PROGRESS_UID).findOne({
        where,
        orderBy: { id: 'asc' },
        populate: {
          user: { select: ['id'] },
          course: { select: ['id'] },
        },
      });
    } catch {
      return null;
    }
  };

  let row =
    (await tryQuery({ user: uid, course: cid }))
    || (await tryQuery({ user: { id: uid }, course: { id: cid } }));
  if (matchesUserCourse(row)) return row;

  // Broader scans — relation filters can miss Strapi 5 link-table rows.
  try {
    const byCourse = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: { course: cid },
      populate: {
        user: { select: ['id'] },
        course: { select: ['id'] },
      },
      orderBy: { id: 'asc' },
      limit: 500,
    });
    row = (byCourse || []).find(matchesUserCourse) || null;
    if (row) return row;
  } catch (_) { /* ignore */ }

  try {
    const byUser = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: { user: uid },
      populate: {
        user: { select: ['id'] },
        course: { select: ['id'] },
      },
      orderBy: { id: 'asc' },
      limit: 200,
    });
    row = (byUser || []).find(matchesUserCourse) || null;
    if (row) return row;
  } catch (_) { /* ignore */ }

  try {
    const docService = strapi.documents(USER_PROGRESS_UID);
    for (const status of ['published', 'draft']) {
      const list = await docService.findMany({
        filters: { user: { id: uid }, course: { id: cid } },
        status,
        limit: 5,
      });
      row = (list || []).find(matchesUserCourse) || (Array.isArray(list) && list[0]) || null;
      if (row) return row;
    }
  } catch (_) { /* ignore */ }

  return null;
}

/**
 * On reassignment: locate and keep the existing user-progress row.
 * Never creates a new row — missing progress is logged as a warning.
 */
async function reuseExistingUserProgressOnReassign(strapi, courseId, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!courseId || !ids.length) return;

  let reused = 0;
  let missing = 0;
  for (const userId of ids) {
    const existing = await findExistingUserProgress(strapi, userId, courseId);
    if (existing) {
      reused++;
      strapi.log.info(
        'user-progress-automation: reassign reuse progress id=%s documentId=%s status=%s userId=%s courseId=%s',
        existing.id,
        existing.documentId || 'n/a',
        existing.progress_status || 'n/a',
        userId,
        courseId
      );
      continue;
    }
    missing++;
    strapi.log.warn(
      'user-progress-automation: reassign found no existing progress for userId=%s courseId=%s — will NOT create a duplicate',
      userId,
      courseId
    );
  }
  if (reused > 0 || missing > 0) {
    strapi.log.info(
      'user-progress-automation: reassign progress reuse done reused=%d missing=%d courseId=%s',
      reused,
      missing,
      courseId
    );
  }
}

/**
 * Create user-progress (Not_started) for each user. Uses Document Service so entries appear in admin (Strapi 5).
 * Never creates a second row for the same user+course (re-assign must keep existing progress).
 */
async function createUserProgressEntries(strapi, courseId, userIds, dueDate) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  userIds = [...new Set(userIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const now = new Date();
  // Normalize the due_date to a plain date string (YYYY-MM-DD) for storage
  const dueDateValue = dueDate
    ? (dueDate instanceof Date ? dueDate : new Date(dueDate)).toISOString().slice(0, 10)
    : null;
  const docService = strapi.documents(USER_PROGRESS_UID);
  let created = 0;
  let skipped = 0;
  for (const userId of userIds) {
    try {
      const existing = await findExistingUserProgress(strapi, userId, courseId);
      if (existing) {
        skipped++;
        strapi.log.info(
          'user-progress-automation: skip create — existing progress id=%s status=%s userId=%s courseId=%s',
          existing.id,
          existing.progress_status || 'n/a',
          userId,
          courseId
        );
        continue;
      }

      await docService.create({
        data: {
          user: userId,
          course: courseId,
          progress_status: 'Not_started',
          progress_percentage: 0,
          completed_modules: [],
          last_accessed_at: now,
          time_spent_minutes: 0,
          certificate_issued: false,
          // Stamp the due_date at assignment time — never overwritten on re-assignment
          ...(dueDateValue ? { due_date: dueDateValue } : {}),
        },
        status: 'published',
      });
      created++;
    } catch (e) {
      strapi.log.warn('createUserProgressEntries failed (userId=%s):', userId, e?.message || String(e));
    }
  }
  if (created > 0 || skipped > 0) {
    strapi.log.info(
      'user-progress-automation: user-progress create done created=%d skippedExisting=%d',
      created,
      skipped
    );
  }
}

/**
 * Compare previous published assignment users vs the new assignment list.
 *   - newlyListedUserIds: in new list, not in old → either brand-new or returning after unassign
 *   - continuedUserIds:   in both lists          → still enrolled; no assign/reassign notif
 *   - unassignedUserIds:  in old list, not in new → dropped from the course
 *
 * Reassignment is NOT "in both lists". A continuous user (e.g. A on old and new)
 * must not get course_reassigned. Reassigned = newly listed again AND already has
 * user-progress for this course (typically after a prior course_unassigned).
 */
function diffAssignmentUserSets(oldUserIds, newUserIds) {
  const toNumericIds = (ids) =>
    [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const oldSet = new Set(toNumericIds(oldUserIds));
  const newSet = new Set(toNumericIds(newUserIds));
  return {
    unassignedUserIds: [...oldSet].filter((id) => !newSet.has(id)),
    newlyListedUserIds: [...newSet].filter((id) => !oldSet.has(id)),
    continuedUserIds: [...newSet].filter((id) => oldSet.has(id)),
  };
}

async function findUniqueOldPublishedAssignments(strapi, numericCourseId, newAssignmentId, newAssignmentDocumentId) {
  const LOG = '[course-assignment-unpublish]';
  let excludeWhere;
  if (newAssignmentDocumentId) {
    let allRowsOfNewDoc = [];
    try {
      allRowsOfNewDoc = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
        where: { documentId: newAssignmentDocumentId },
        select: ['id'],
      });
    } catch (_) {}
    const idsToExclude = [...new Set([
      newAssignmentId,
      ...allRowsOfNewDoc.map((r) => r.id).filter(Boolean),
    ])];
    excludeWhere = { id: { $notIn: idsToExclude } };
  } else {
    excludeWhere = { id: { $ne: newAssignmentId } };
  }

  let oldAssignments = [];
  try {
    const oldWhere = Object.assign(
      {},
      excludeWhere,
      { active: 'published', courses: { id: numericCourseId } },
      newAssignmentDocumentId ? { documentId: { $ne: newAssignmentDocumentId } } : {}
    );
    oldAssignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: oldWhere,
      populate: {
        individual_user: { select: ['id', 'email'] },
        departments: { select: ['name'] },
        work_locations: { select: ['name'] },
        company: { select: ['name'] },
      },
      limit: 1000,
    });
  } catch (e) {
    strapi.log.warn(`${LOG} failed fetching old assignments courseId=${numericCourseId}: ${e?.message || e}`);
    return [];
  }

  const seenDocIds = new Set();
  const uniqueOldAssignments = [];
  for (const a of oldAssignments) {
    const key = a.documentId ? `doc:${a.documentId}` : `id:${a.id}`;
    if (seenDocIds.has(key)) continue;
    seenDocIds.add(key);
    uniqueOldAssignments.push(a);
  }
  return uniqueOldAssignments;
}

async function collectUserIdsFromAssignments(strapi, assignments) {
  const ids = new Set();
  for (const assignment of assignments || []) {
    try {
      const payload = await getAssignedUserIds(strapi, assignment.id);
      for (const uid of payload?.userIds || []) {
        const n = Number(uid);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    } catch (e) {
      strapi.log.warn(
        '[course-assignment-unpublish] failed resolving users for old assignment id=%s: %s',
        assignment?.id,
        e?.message || e
      );
      const users = Array.isArray(assignment?.individual_user) ? assignment.individual_user : [];
      const extracted = users.map(getUserId).filter(Boolean);
      const numericIds = [];
      const docIds = [];
      for (const id of extracted) {
        if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(String(id)))) {
          numericIds.push(Number(id));
        } else if (typeof id === 'string' && id.length > 0) {
          docIds.push(id);
        }
      }
      if (docIds.length > 0) {
        try {
          const resolved = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: { documentId: { $in: docIds } },
            select: ['id'],
          });
          (resolved || []).forEach((u) => { if (u?.id) numericIds.push(Number(u.id)); });
        } catch (_) {}
      }
      numericIds.forEach((n) => { if (Number.isFinite(n) && n > 0) ids.add(n); });
    }
  }
  return [...ids];
}

/**
 * When a new course-assignment is created for a course:
 *  1. Find all OTHER published assignments for that same course (excluding the new one).
 *  2. Mark them active='unpublished'.
 *  3. Collect users covered by those OLD assignments who are NOT in the new assignment's user list.
 *  4. Send those removed users a professional notification.
 * @returns {{ oldUserIds: number[], unassignedUserIds: number[], continuedUserIds: number[], newlyListedUserIds: number[] }}
 */
async function autoUnpublishOldAssignmentsForCourse(
  strapi,
  numericCourseId,
  newAssignmentId,
  newAssignmentDocumentId,
  newUserIds
) {
  const LOG = '[course-assignment-unpublish]';
  const nextUserIds = [...new Set((newUserIds || []).map(Number).filter(Boolean))];

  const uniqueOldAssignments = await findUniqueOldPublishedAssignments(
    strapi,
    numericCourseId,
    newAssignmentId,
    newAssignmentDocumentId
  );

  if (uniqueOldAssignments.length === 0) {
    strapi.log.info(`${LOG} no old published assignments found for courseId=${numericCourseId} (newAssignmentId=${newAssignmentId})`);
    return;
  }

  strapi.log.info(`${LOG} unique old assignments: ${uniqueOldAssignments.length}`);

  const oldUserIds = await collectUserIdsFromAssignments(strapi, uniqueOldAssignments);
  const { unassignedUserIds } = diffAssignmentUserSets(oldUserIds, nextUserIds);

  strapi.log.info(
    `${LOG} user split courseId=%s old=%d new=%d unassigned=%d`,
    numericCourseId,
    oldUserIds.length,
    nextUserIds.length,
    unassignedUserIds.length
  );

  if (unassignedUserIds.length > 0) {
    await sendCourseUnassignedNotifications(strapi, unassignedUserIds, [numericCourseId]);
  } else {
    strapi.log.info(`${LOG} no removed users to notify for courseId=${numericCourseId}`);
  }

  for (const oldAssignment of uniqueOldAssignments) {
    try {
      if (oldAssignment.documentId) {
        await strapi.db.query(COURSE_ASSIGNMENT_UID).updateMany({
          where: { documentId: oldAssignment.documentId },
          data: { active: 'unpublished' },
        });
      } else {
        await strapi.db.query(COURSE_ASSIGNMENT_UID).updateMany({
          where: { id: oldAssignment.id },
          data: { active: 'unpublished' },
        });
      }
      strapi.log.info(`${LOG} marked assignment documentId=${oldAssignment.documentId ?? oldAssignment.id} as unpublished`);
    } catch (e) {
      strapi.log.warn(`${LOG} failed unpublishing assignment id=${oldAssignment.id}: ${e?.message || e}`);
    }
  }
}

function registerUserProgressLifecycles(strapi) {
  // Due dates are per-user on user-progress — notify when that field changes.
  strapi.db.lifecycles.subscribe({
    models: [USER_PROGRESS_UID],

    async beforeUpdate(event) {
      if (_creatingSubEntries || _backfillingDueDates) return;
      try {
        await captureUserProgressDueDateChange(strapi, event.params?.data, event.params?.where);
      } catch (e) {
        strapi.log.warn('user-progress-automation (user-progress beforeUpdate):', e?.message || e);
      }
    },

    async afterUpdate(event) {
      if (_creatingSubEntries || _backfillingDueDates) return;

      try {
        const { result, params = {} } = event;
        if (!result) return;

        // Draft-only saves should not notify; published rows (or types without D&P publish gate) do.
        const isPublished = result.publishedAt != null || result.published_at != null;
        const hasPublishField = Object.prototype.hasOwnProperty.call(result, 'publishedAt')
          || Object.prototype.hasOwnProperty.call(result, 'published_at');
        if (hasPublishField && !isPublished) return;

        const key = getProgressLifecycleKey(result);
        const previousDueDate = key ? _prevDueDateByProgressKey.get(key) : undefined;
        if (key) _prevDueDateByProgressKey.delete(key);

        // Prefer captured previous; if map missed, still allow when due_date is in the payload.
        if (previousDueDate === undefined && params?.data?.due_date === undefined) return;

        const newDueDate = formatDueDateValue(params.data?.due_date ?? result?.due_date);
        // Skip first stamp (null/empty -> value) — that is assignment create, not a due-date update.
        if (!previousDueDate || previousDueDate === newDueDate) return;

        strapi.log.info(
          'user-progress-automation: user-progress due_date changed (%s, %s -> %s)',
          key || 'n/a',
          previousDueDate,
          newDueDate || 'n/a'
        );

        await sendDueDateChangedForUserProgress(strapi, result, params);
      } catch (e) {
        strapi.log.error('user-progress-automation (user-progress afterUpdate):', e?.message || e);
      }
    },

    async afterCreate(event) {
      // Strapi 5 D&P: editing then publishing can create a new published row.
      if (_creatingSubEntries || _backfillingDueDates) return;
      try {
        const { result } = event;
        if (!result?.publishedAt && !result?.published_at) return;
        if (!result?.documentId || result?.id == null) return;

        const siblings = await strapi.db.query(USER_PROGRESS_UID).findMany({
          where: {
            documentId: String(result.documentId),
            id: { $ne: Number(result.id) },
            publishedAt: { $notNull: true },
          },
          select: ['due_date'],
          orderBy: { updatedAt: 'desc' },
          limit: 1,
        });
        if (!siblings.length) return;

        const previousDueDate = formatDueDateValue(siblings[0].due_date);
        const newDueDate = formatDueDateValue(result.due_date);
        if (!previousDueDate || previousDueDate === newDueDate) return;

        strapi.log.info(
          'user-progress-automation: user-progress due_date changed on publish (%s, %s -> %s)',
          result.documentId,
          previousDueDate,
          newDueDate || 'n/a'
        );
        await sendDueDateChangedForUserProgress(strapi, result, { data: { due_date: result.due_date } });
      } catch (e) {
        strapi.log.error('user-progress-automation (user-progress afterCreate):', e?.message || e);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [COURSE_ASSIGNMENT_UID],

    async afterCreate(event) {
      try {
        const { result, params = {} } = event;

        if (!result.publishedAt && !result.published_at) return;

        if (result?.assignment_target_type === 'Individual' && _creatingSubEntries) return;

        // Existing assignment republish/edit: document middleware owns the user diff
        // (and claims the doc before publish next()). Skip here to avoid double/miss.
        const isExistingAssignmentEdit = await isRepublicationAfterEdit(strapi, result);
        if (isExistingAssignmentEdit) {
          if (isAssignmentDiffHandled(result?.documentId)) {
            strapi.log.info(
              'user-progress-automation: skip afterCreate edit diff — already handled by document middleware (documentId=%s)',
              result?.documentId ?? 'n/a'
            );
            return;
          }
          strapi.log.info(
            'user-progress-automation: existing assignment update — syncing user add/remove (documentId=%s)',
            result?.documentId ?? 'n/a'
          );
          await handleExistingAssignmentUserChanges(strapi, result, params);
          return;
        }

        const documentIdKey = result?.documentId ? String(result.documentId) : '';
        const dedupeKey = documentIdKey
          || (result?.id != null ? `create-id:${result.id}` : '');
        const middlewareAlreadyHandled = Boolean(dedupeKey && isAssignmentDiffHandled(dedupeKey));
        if (middlewareAlreadyHandled) {
          strapi.log.info(
            'user-progress-automation: afterCreate notify skipped — document middleware already handled (documentId=%s)',
            dedupeKey || 'n/a'
          );
        } else if (dedupeKey) {
          markAssignmentDiffHandled(dedupeKey);
        }

        const assignmentId = result.id ?? result.documentId;
        let payload = null;
        if (params.data) {
          payload = await getAssignedUserIdsFromParams(strapi, params, result);
        }
        if (!payload || !payload.userIds || payload.userIds.length === 0) {
          if (assignmentId != null) {
            await new Promise((r) => setTimeout(r, 200));
            payload = await getAssignedUserIds(strapi, assignmentId);
          }
        }
        let { courseId, courseIds, userIds, due_date, active, targetType } = payload || {};
        if (!courseId || !userIds || userIds.length === 0) {
          if (assignmentId == null) strapi.log.warn('user-progress-automation: afterCreate no id/documentId', result);
          return;
        }
        userIds = [...new Set(userIds)];

        const allCourseIds = (Array.isArray(courseIds) && courseIds.length > 0) ? [...new Set(courseIds)] : [courseId];
        const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };

        for (const rawCourseId of allCourseIds) {
          const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
          if (!numericCourseId) continue;

          const uniqueOldAssignments = await findUniqueOldPublishedAssignments(
            strapi,
            numericCourseId,
            result.id,
            result.documentId
          );
          const oldUserIds = await collectUserIdsFromAssignments(strapi, uniqueOldAssignments);
          const {
            newlyListedUserIds,
            continuedUserIds,
            unassignedUserIds,
          } = await reconcileAssignmentUserDiff(
            strapi,
            oldUserIds,
            userIds,
            numericCourseId
          );

          const {
            assignedUserIds: newUserIds,
            reassignedUserIds,
            progressNewIds,
          } = await classifyNewlyListedUsersForNotifications(
            strapi,
            newlyListedUserIds,
            numericCourseId
          );

          strapi.log.info(
            'user-progress-automation: afterCreate courseId=%s — new=%d reassigned=%d continued=%d unassigned=%d oldCollected=%d skipNotify=%s',
            numericCourseId,
            newUserIds.length,
            reassignedUserIds.length,
            continuedUserIds.length,
            unassignedUserIds.length,
            oldUserIds.length,
            middlewareAlreadyHandled
          );

          if (!middlewareAlreadyHandled) {
            const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);

            if (newUserIds.length > 0) {
              await notifyAssignmentUsersForCourse(strapi, {
                type: 'course_assigned',
                title: 'Course Assigned',
                message: `"${courseTitle}" has been assigned to you.`,
                rawCourseId,
                userIds: newUserIds,
                meta: { assignedBy: null, level: levelMap[targetType] || targetType },
                targetType,
                excludeCompletedUsers: true,
              });
            }

            if (reassignedUserIds.length > 0) {
              await notifyAssignmentUsersForCourse(strapi, {
                type: 'course_reassigned',
                title: 'Course Reassigned',
                message: `"${courseTitle}" has been reassigned to you.`,
                rawCourseId,
                userIds: reassignedUserIds,
                meta: { assignedBy: null, level: levelMap[targetType] || targetType },
                targetType,
                excludeCompletedUsers: false,
              });
            }
          }

          if (reassignedUserIds.length > 0) {
            await reuseExistingUserProgressOnReassign(strapi, numericCourseId, reassignedUserIds);
          }

          await createUserProgressEntries(strapi, numericCourseId, progressNewIds, due_date);

          if (targetType !== 'Individual') {
            await createCourseAssignmentEntries(strapi, numericCourseId, userIds, due_date, active, payload?.company);
          }

          try {
            await new Promise((r) => setTimeout(r, 300));
            await autoUnpublishOldAssignmentsForCourse(
              strapi,
              numericCourseId,
              result.id,
              result.documentId,
              userIds
            );
          } catch (unpubErr) {
            strapi.log.error(
              'user-progress-automation: autoUnpublishOldAssignments failed courseId=%s: %s',
              numericCourseId, unpubErr?.message || unpubErr
            );
          }
        }
      } catch (e) {
        strapi.log.error('user-progress-automation (course-assignment afterCreate):', e?.message || e);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [QUIZ_SUBMISSION_UID],
    async afterCreate(event) {
      try {
        const { result } = event;
        const userId = getUserId(result.submitted_by) ?? result.submitted_by_id;
        const courseId = getCourseId(result.course) ?? result.course_id;
        const passed = result.passed === true;
        if (!userId || !courseId) return;

        const numCourseId = await resolveCourseIdForDb(strapi, courseId);
        if (!numCourseId) return;

        const progress = await strapi.db.query(USER_PROGRESS_UID).findOne({
          where: { user: userId, course: numCourseId },
        });
        if (!progress) return;

        // Fetch course for module count + feedback compulsory flag
        const course = await strapi.db.query(COURSE_UID).findOne({
          where: { id: numCourseId },
          populate: { modules: true, feedback: true },
        });
        // Filter modules by the user's selected language
        const effectiveLang = progress.selected_language ?? null;
        const allModules = Array.isArray(course?.modules) ? course.modules : [];
        const langNorm = effectiveLang ? effectiveLang.trim().toLowerCase() : null;
        const langModules = langNorm
          ? allModules.filter((m) => (m.language || '').trim().toLowerCase() === langNorm)
          : allModules;
        const totalModules = (langModules.length > 0 ? langModules : allModules).length;
        const completedModules = Array.isArray(progress.completed_modules) ? progress.completed_modules : [];
        const modulePct = totalModules > 0 ? Math.round((completedModules.length / totalModules) * 90) : 0;
        // Quiz = 10% always; feedback has no weight → passing quiz completes the course
        const quizPct = 10;
        const now = new Date();

        let updateData;
        if (passed) {
          // Quiz passed → course complete at modulePct + 10%
          updateData = {
            progress_status: 'Completed',
            progress_percentage: modulePct + quizPct,
            completed_at: now,
            last_accessed_at: now,
            certificate_issued: true,
          };
        } else {
          // Failed: keep module-only percentage
          updateData = {
            progress_status: 'Failed',
            progress_percentage: modulePct,
            completed_at: null,
            last_accessed_at: now,
          };
        }

        await strapi.db.query(USER_PROGRESS_UID).update({
          where: { id: progress.id },
          data: updateData,
        });
      } catch (e) {
        strapi.log.error('user-progress-automation (quiz-submission afterCreate):', e?.message || e);
      }
    },
  });

  strapi.log.info('User-progress automation: user-progress due_date → notify; course-assignment → Not_started; quiz-submission → In_progress/Failed');
}

/**
 * One-time backfill: for every user_progress record that has no due_date,
 * find the OLDEST course-assignment (any active value, including unpublished)
 * that contained that user for that course, and stamp its due_date.
 *
 * This repairs records created before the due_date field was added to the schema.
 * Safe to run repeatedly — skips records that already have a due_date.
 */
async function backfillUserProgressDueDates(strapi) {
  const LOG = '[due-date-backfill]';
  strapi.log.info(`${LOG} starting backfill of user_progress due_date…`);
  _backfillingDueDates = true;

  let progressRecords = [];
  try {
    progressRecords = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: { due_date: { $null: true } },
      populate: { user: { select: ['id'] }, course: { select: ['id'] } },
      limit: 10000,
    });
  } catch (e) {
    _backfillingDueDates = false;
    strapi.log.error(`${LOG} failed to fetch user_progress records: ${e?.message || e}`);
    return;
  }

  if (!progressRecords.length) {
    _backfillingDueDates = false;
    strapi.log.info(`${LOG} nothing to backfill — all records already have due_date`);
    return;
  }

  strapi.log.info(`${LOG} found ${progressRecords.length} records without due_date`);

  let updated = 0;
  let skipped = 0;

  try {
  for (const record of progressRecords) {
    const userId = record.user?.id ?? record.user;
    const courseId = record.course?.id ?? record.course;
    if (!userId || !courseId) { skipped++; continue; }

    try {
      // Find ALL assignments (published + unpublished) for this course that
      // contain this user as an Individual assignee, ordered oldest first.
      const assignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
        where: {
          assignment_target_type: 'Individual',
          courses: { id: Number(courseId) },
          individual_user: { id: Number(userId) },
        },
        select: ['id', 'due_date', 'createdAt'],
        orderBy: { createdAt: 'asc' },
        limit: 100,
      });

      if (!assignments.length) { skipped++; continue; }

      // Pick the oldest assignment's due_date — that is the user's original date
      const oldest = assignments[0];
      const dueDateRaw = oldest.due_date;
      if (!dueDateRaw) { skipped++; continue; }

      const dueValue = (dueDateRaw instanceof Date
        ? dueDateRaw
        : new Date(dueDateRaw)
      ).toISOString().slice(0, 10);

      await strapi.db.query(USER_PROGRESS_UID).update({
        where: { id: record.id },
        data: { due_date: dueValue },
      });

      updated++;
    } catch (e) {
      strapi.log.warn(`${LOG} failed for userId=${userId} courseId=${courseId}: ${e?.message || e}`);
      skipped++;
    }
  }
  } finally {
    _backfillingDueDates = false;
  }

  strapi.log.info(`${LOG} done — updated=${updated} skipped=${skipped}`);
}

module.exports = {
  registerUserProgressLifecycles,
  backfillUserProgressDueDates,
  handleUserProgressDueDateDocumentMiddleware,
  handleCourseAssignmentDocumentMiddleware,
};
