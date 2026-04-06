'use strict';

/**
 * course-assignment controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::course-assignment.course-assignment', ({ strapi }) => ({
  async importUsersFromExcel(ctx) {
    const body = ctx.request.body || {};
    let identifiers = [];

    if (Array.isArray(body.identifiers)) {
      // CSV pre-parsed on the frontend — receive identifier strings directly
      identifiers = body.identifiers.map((s) => String(s || '').trim()).filter(Boolean);
    } else if (body.fileContent) {
      // XLSX / XLS sent as base64 from the browser — parse server-side
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const XLSX = require('xlsx');
        const base64 = String(body.fileContent).replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames && workbook.SheetNames[0];
        if (!sheetName) return ctx.badRequest('No sheets found in the workbook');
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // Skip a header row if the first cell is a known column label
        const knownHeaders = new Set(['email', 'emp_code', 'emp_id', 'username', 'user', 'identifier', 'name']);
        let startRow = 0;
        if (rows.length > 0) {
          const firstCell = String((rows[0] && rows[0][0]) || '').trim().toLowerCase();
          if (knownHeaders.has(firstCell)) startRow = 1;
        }

        identifiers = rows
          .slice(startRow)
          .map((row) => String((row && row[0]) || '').trim())
          .filter(Boolean);
      } catch (e) {
        return ctx.badRequest('Failed to parse Excel file: ' + (e?.message || String(e)));
      }
    } else {
      return ctx.badRequest('Provide identifiers array (CSV) or fileContent (Excel base64)');
    }

    if (identifiers.length === 0) return ctx.badRequest('No identifiers found in the file');
    if (identifiers.length > 2000) return ctx.badRequest('Too many rows — maximum 2000 per import');

    // Build OR clauses based on which searchable fields exist on the user model
    const userModel = strapi.getModel('plugin::users-permissions.user');
    const attrs = (userModel && userModel.attributes) || {};

    const orClauses = [];
    if (attrs.email)    orClauses.push({ email:    { $in: identifiers } });
    if (attrs.username) orClauses.push({ username: { $in: identifiers } });
    if (attrs.emp_code) orClauses.push({ emp_code: { $in: identifiers } });
    if (attrs.emp_id)   orClauses.push({ emp_id:   { $in: identifiers } });

    if (orClauses.length === 0) return ctx.badRequest('No matchable user fields found on the user model');

    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: orClauses.length === 1 ? orClauses[0] : { $or: orClauses },
      select: ['id', 'documentId', 'email', 'username', 'emp_code', 'emp_id'],
      limit: 2000,
    });

    // Collect every identifier that matched at least one user field
    const matched = new Set();
    for (const user of users || []) {
      for (const field of ['email', 'username', 'emp_code', 'emp_id']) {
        const val = user[field];
        if (val != null && identifiers.includes(String(val))) matched.add(String(val));
      }
    }

    const notFound = identifiers.filter((id) => !matched.has(id));

    return ctx.send({
      found: (users || []).map((u) => ({
        id: u.id,
        documentId: u.documentId,
        username: u.username || null,
        email: u.email || null,
      })),
      notFound,
    });
  },

  async assign(ctx) {
    const { level, courseId, assignedBy, userId, departmentId, companyId, workLocationId } = ctx.request.body;
    const util = strapi.utils?.notification;
    if (!util) return ctx.internalServerError('Notification util not available');

    let users = [];
    if (level === 'individual' && userId) {
      const u = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId }, select: ['id', 'email'] });
      if (u) users = [u];
    } else if (level === 'department' && departmentId) {
      users = await util.getUsersByDepartment(departmentId);
    } else if (level === 'company' && companyId) {
      users = await util.getUsersByCompany(companyId);
    } else if (level === 'work_location' && workLocationId) {
      users = await util.getUsersByWorkLocation(workLocationId);
    }

    // Fetch course title for a meaningful notification message
    let courseTitle = 'A new course';
    if (courseId) {
      try {
        const course = await strapi.db.query('api::course.course').findOne({
          where: { $or: [{ id: courseId }, { documentId: courseId }] },
          select: ['title'],
        });
        if (course?.title) courseTitle = course.title;
      } catch { /* keep default */ }
    }

    // Admin → User: only the assigned user gets notification (bell) + email
    const meta = { courseId, assignedBy, level };
    await util.sendNotification(
      'course_assigned',
      'Course Assigned',
      `"${courseTitle}" has been assigned to you.`,
      users,
      meta,
      [] // no admin roles: notification goes only to user's bell + email
    );
    return ctx.send({ message: 'Course assigned and notifications sent.' });
  },
}));
