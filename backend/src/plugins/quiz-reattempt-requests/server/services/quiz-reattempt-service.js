const UID = 'api::quiz-reattempt-request.quiz-reattempt-request';
const {
  resolveAssignmentForUserCourse,
  loadActiveAssignments,
  loadUsersByIds,
  getRelationId,
  updateAssignmentDueDate,
  buildDueDatePayload,
  toDateOnly,
} = require('./assignment-due-date-helper');

async function enrichEntry(strapi, entry, assignments, userMap) {
  const userId = getRelationId(entry.users_permissions_user);
  const courseId = getRelationId(entry.course);
  const user = userId != null ? userMap.get(Number(userId)) : null;
  const resolved = resolveAssignmentForUserCourse(assignments, user, courseId);
  return {
    ...entry,
    assignment_due_date: buildDueDatePayload(resolved),
  };
}

module.exports = ({ strapi }) => ({
  async getAll() {
    const entries = await strapi.db.query(UID).findMany({
      populate: ['users_permissions_user', 'course'],
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(
        (entries || [])
          .map((e) => getRelationId(e.users_permissions_user))
          .filter((id) => id != null)
          .map(Number)
      ),
    ];

    const [assignments, userMap] = await Promise.all([
      loadActiveAssignments(strapi),
      loadUsersByIds(strapi, userIds),
    ]);

    const enriched = await Promise.all(
      (entries || []).map((entry) => enrichEntry(strapi, entry, assignments, userMap))
    );

    strapi.log.info('[quiz-reattempt plugin] getAll count:', enriched?.length ?? 0);

    return enriched;
  },

  async updateStatus(id, newStatus, options = {}) {
    const isNumeric = /^\d+$/.test(String(id));
    const where = isNumeric ? { id: Number(id) } : { documentId: String(id) };

    const existing = await strapi.db.query(UID).findOne({
      where,
      populate: ['users_permissions_user', 'course'],
    });
    if (!existing) {
      strapi.log.warn('[quiz-reattempt plugin] updateStatus: not found', id);
      throw new Error('Request not found');
    }

    const extendedDueDate = options.extendedDueDate;
    let appliedDueDate = null;

    if (newStatus === 'Approved' && extendedDueDate) {
      const userId = getRelationId(existing.users_permissions_user);
      const courseId = getRelationId(existing.course);
      if (userId == null || courseId == null) {
        throw new Error('Request is missing user or course');
      }

      const normalizedDue = toDateOnly(extendedDueDate);
      if (!normalizedDue) {
        throw new Error('Invalid extended due date');
      }

      const [assignments, userMap] = await Promise.all([
        loadActiveAssignments(strapi),
        loadUsersByIds(strapi, [Number(userId)]),
      ]);
      const user = userMap.get(Number(userId));
      const resolved = resolveAssignmentForUserCourse(assignments, user, courseId);

      if (!resolved.assignment) {
        throw new Error('No course assignment found for this user and course');
      }

      appliedDueDate = await updateAssignmentDueDate(strapi, resolved.assignment, normalizedDue);
      strapi.log.info(
        '[quiz-reattempt plugin] extended due_date to %s (assignment=%s, type=%s, user=%s, course=%s)',
        appliedDueDate,
        resolved.assignment.documentId ?? resolved.assignment.id,
        resolved.assignment.assignment_target_type,
        userId,
        courseId
      );
    }

    await strapi.db.query(UID).update({
      where: { id: existing.id },
      data: { request_status: newStatus },
    });

    const updated = await strapi.db.query(UID).findOne({
      where: { id: existing.id },
      populate: ['users_permissions_user', 'course'],
    });
    if (!updated) return null;

    const userId = getRelationId(updated.users_permissions_user);
    const courseId = getRelationId(updated.course);
    const [assignments, userMap] = await Promise.all([
      loadActiveAssignments(strapi),
      loadUsersByIds(strapi, userId != null ? [Number(userId)] : []),
    ]);
    const enriched = await enrichEntry(
      strapi,
      updated,
      assignments,
      userMap
    );

    if (appliedDueDate) {
      enriched.applied_extended_due_date = appliedDueDate;
    }

    return enriched;
  },
});
