'use strict';

const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';

function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getDueDateMeta(dueDate) {
  const due = toDateOnly(dueDate);
  if (!due) {
    return {
      due_date: null,
      days_remaining: null,
      is_past_due: false,
      due_status: 'unknown',
      due_status_label: 'No due date',
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const dueMs = new Date(`${due}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const diffDays = Math.round((dueMs - todayMs) / 86400000);

  let due_status = 'upcoming';
  let due_status_label = `${diffDays} day${diffDays === 1 ? '' : 's'} left`;

  if (diffDays < 0) {
    due_status = 'past_due';
    const overdue = Math.abs(diffDays);
    due_status_label = overdue === 1 ? 'Past due (1 day)' : `Past due (${overdue} days)`;
  } else if (diffDays === 0) {
    due_status = 'due_today';
    due_status_label = 'Due today';
  }

  return {
    due_date: due,
    days_remaining: diffDays,
    is_past_due: diffDays < 0,
    due_status,
    due_status_label,
  };
}

function assignmentIncludesCourse(assignment, courseId) {
  const numCourseId = Number(courseId);
  if (!Number.isFinite(numCourseId)) return false;
  const courses = Array.isArray(assignment?.courses) ? assignment.courses : [];
  if (courses.some((c) => Number(c?.id) === numCourseId)) return true;
  const legacy = assignment?.course;
  if (legacy && Number(legacy.id ?? legacy) === numCourseId) return true;
  return false;
}

function isActiveAssignment(assignment) {
  const active = assignment?.active;
  return active === 'published' || active == null;
}

function userMatchesDepartmentAssignment(user, assignment) {
  if (!user?.department || !Array.isArray(assignment?.departments)) return false;
  const userDept = String(user.department).trim().toLowerCase();
  return assignment.departments.some((d) => {
    const name = d?.name ?? d?.attributes?.name;
    return name && String(name).trim().toLowerCase() === userDept;
  });
}

function userMatchesLocationAssignment(user, assignment) {
  const locations = assignment?.work_locations ?? assignment?.unit_locations;
  if (!Array.isArray(locations) || locations.length === 0) return false;
  const locationNames = locations.map((l) => l?.name).filter(Boolean);
  if (locationNames.length === 0) return false;
  const userLocation = user?.company === 'AIA' ? user?.branch : user?.working_location;
  if (!userLocation) return false;
  const uLoc = String(userLocation).trim().toLowerCase();
  return locationNames.some((n) => String(n).trim().toLowerCase() === uLoc);
}

function userMatchesIndividualAssignment(user, assignment) {
  const users = Array.isArray(assignment?.individual_user) ? assignment.individual_user : [];
  const userId = Number(user?.id);
  const userDocumentId = user?.documentId ?? null;
  return users.some((u) => {
    const relId = u?.id;
    const relDocId = u?.documentId ?? u?.document_id;
    if (relId != null && Number(relId) === userId) return true;
    if (userDocumentId && relDocId && String(relDocId) === String(userDocumentId)) return true;
    return false;
  });
}

function pickAssignmentSummary(assignment) {
  const users = Array.isArray(assignment?.individual_user) ? assignment.individual_user : [];
  return {
    assignment_id: assignment?.id ?? null,
    assignment_document_id: assignment?.documentId ?? null,
    assignment_target_type: assignment?.assignment_target_type ?? null,
    shared_user_count:
      assignment?.assignment_target_type === 'Individual' ? users.length : null,
    affects_multiple_users:
      assignment?.assignment_target_type === 'Individual' && users.length > 1,
  };
}

/**
 * Resolve the course-assignment row used for due date display and updates.
 * Department/Location parent rows take priority over per-user Individual child rows.
 */
function resolveAssignmentForUserCourse(assignments, user, courseId) {
  if (!user || courseId == null) {
    return { assignment: null, ...getDueDateMeta(null), ...pickAssignmentSummary({}) };
  }

  const forCourse = (assignments || []).filter(
    (a) => isActiveAssignment(a) && assignmentIncludesCourse(a, courseId)
  );

  const departmentMatch = forCourse.find(
    (a) => a.assignment_target_type === 'Department' && userMatchesDepartmentAssignment(user, a)
  );
  if (departmentMatch) {
    return {
      assignment: departmentMatch,
      ...pickAssignmentSummary(departmentMatch),
      ...getDueDateMeta(departmentMatch.due_date),
    };
  }

  const locationMatch = forCourse.find(
    (a) => a.assignment_target_type === 'Location' && userMatchesLocationAssignment(user, a)
  );
  if (locationMatch) {
    return {
      assignment: locationMatch,
      ...pickAssignmentSummary(locationMatch),
      ...getDueDateMeta(locationMatch.due_date),
    };
  }

  const individualMatch = forCourse.find(
    (a) => a.assignment_target_type === 'Individual' && userMatchesIndividualAssignment(user, a)
  );
  if (individualMatch) {
    return {
      assignment: individualMatch,
      ...pickAssignmentSummary(individualMatch),
      ...getDueDateMeta(individualMatch.due_date),
    };
  }

  return { assignment: null, ...getDueDateMeta(null), ...pickAssignmentSummary({}) };
}

async function loadActiveAssignments(strapi) {
  return strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
    where: {
      $or: [{ active: 'published' }, { active: { $null: true } }],
    },
    populate: {
      courses: { select: ['id'] },
      departments: { select: ['name'] },
      work_locations: { select: ['name'] },
      individual_user: { select: ['id', 'documentId'] },
    },
    limit: 10000,
  });
}

async function loadUsersByIds(strapi, userIds) {
  if (!userIds.length) return new Map();
  const rows = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: { id: { $in: userIds } },
    select: ['id', 'documentId', 'department', 'company', 'branch', 'working_location'],
  });
  return new Map((rows || []).map((u) => [Number(u.id), u]));
}

function getRelationId(relation) {
  if (relation == null) return null;
  if (typeof relation === 'number') return relation;
  if (typeof relation === 'object') return relation.id ?? relation.data?.id ?? null;
  return null;
}

async function updateAssignmentDueDate(strapi, assignment, extendedDueDate) {
  const dueValue = toDateOnly(extendedDueDate);
  if (!dueValue) {
    throw new Error('Invalid extended due date');
  }
  if (!assignment) {
    throw new Error('No course assignment found for this user and course');
  }

  const docService = strapi.documents(COURSE_ASSIGNMENT_UID);

  if (assignment.documentId) {
    await docService.update({
      documentId: assignment.documentId,
      data: { due_date: dueValue },
      status: 'published',
    });
  } else if (assignment.id != null) {
    await strapi.db.query(COURSE_ASSIGNMENT_UID).update({
      where: { id: assignment.id },
      data: { due_date: dueValue },
    });
  } else {
    throw new Error('Course assignment record is missing an id');
  }

  return dueValue;
}

function buildDueDatePayload(resolved) {
  const { assignment, ...meta } = resolved;
  return {
    ...meta,
    assignment_id: meta.assignment_id ?? assignment?.id ?? null,
    assignment_document_id: meta.assignment_document_id ?? assignment?.documentId ?? null,
  };
}

module.exports = {
  COURSE_ASSIGNMENT_UID,
  toDateOnly,
  getDueDateMeta,
  resolveAssignmentForUserCourse,
  loadActiveAssignments,
  loadUsersByIds,
  getRelationId,
  updateAssignmentDueDate,
  buildDueDatePayload,
};
