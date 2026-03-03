'use strict';

/**
 * Event-based notification utility for Strapi v5.
 * Centralizes notification logic: DB + email + socket.io.
 * Use via: strapi.utils.notification.sendNotification(...)
 */

module.exports = (strapi) => {
  const NOTIFICATION_UID = 'api::notification.notification';
  const USER_UID = 'plugin::users-permissions.user';

  /**
   * Enrich meta with human-readable names (userName, courseTitle, newsTitle)
   * so the admin UI can show friendly labels without extra API calls.
   */
  async function enrichMeta(meta = {}) {
    const out = { ...(meta || {}) };

    // Resolve userName from userId (portal user: employee_name, username, email)
    if (out.userId != null && out.userId !== '' && !out.userName) {
      try {
        const userRow = await strapi.db.query(USER_UID).findOne({
          where: { id: Number(out.userId) },
          select: ['id', 'username', 'email', 'employee_name'],
        });
        if (userRow) {
          out.userName =
            userRow.employee_name ||
            userRow.username ||
            userRow.email ||
            `User ${userRow.id}`;
        }
      } catch (err) {
        strapi.log.warn('[notification] enrichMeta user error:', err?.message || err);
      }
    }

    // Resolve courseTitle from courseId (numeric id or documentId)
    if (out.courseId != null && out.courseId !== '' && !out.courseTitle) {
      try {
        const courseId = Number(out.courseId);
        let courseRow = null;
        if (!Number.isNaN(courseId)) {
          courseRow = await strapi.db.query('api::course.course').findOne({
            where: { id: courseId },
            select: ['id', 'title'],
          });
        }
        if (!courseRow && String(out.courseId)) {
          courseRow = await strapi.db.query('api::course.course').findOne({
            where: { documentId: String(out.courseId) },
            select: ['id', 'documentId', 'title'],
          });
        }
        if (courseRow?.title) {
          out.courseTitle = courseRow.title;
        }
      } catch (err) {
        strapi.log.warn('[notification] enrichMeta course error:', err?.message || err);
      }
    }

    // Optional: resolve newsTitle from newsId (documentId)
    if (out.newsId && !out.newsTitle) {
      try {
        const newsRow = await strapi.db.query('api::news.news').findOne({
          where: { documentId: String(out.newsId) },
          select: ['id', 'title'],
        });
        if (newsRow?.title) {
          out.newsTitle = newsRow.title;
        }
      } catch (err) {
        strapi.log.warn('[notification] enrichMeta news error:', err?.message || err);
      }
    }

    return out;
  }

  /**
   * Send email via Strapi email plugin (Nodemailer)
   */
  async function sendEmail(to, subject, body) {
    if (!to || !subject) return;
    try {
      await strapi.plugins.email.services.email.send({
        to,
        subject,
        text: body,
        html: body,
      });
      strapi.log.info('[notification] Email sent to:', to);
    } catch (err) {
      strapi.log.error('[notification] Email send error:', err?.message || err);
    }
  }

  /**
   * Emit socket.io event to target user(s)
   */
  function triggerSocket(userIds, payload) {
    if (!strapi.io) {
      strapi.log.warn('[notification] Socket skipped: strapi.io not available');
      return;
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      strapi.log.warn('[notification] Socket skipped: no userIds provided');
      return;
    }
    const ids = userIds.filter(Boolean).map(String);
    ids.forEach((id) => {
      const room = `user_${id}`;
      strapi.io.to(room).emit('new-notification', payload);
      strapi.log.info('[notification] Socket emitted to room:', room, 'type:', payload?.type);
    });
  }

  /**
   * Emit socket.io event to admin user(s)
   */
  function triggerAdminSocket(adminIds, payload) {
    if (!strapi.io) {
      strapi.log.warn('[notification] Admin socket skipped: strapi.io not available');
      return;
    }
    if (!Array.isArray(adminIds) || adminIds.length === 0) {
      strapi.log.warn('[notification] Admin socket skipped: no adminIds provided');
      return;
    }
    const ids = adminIds.filter(Boolean).map(String);
    ids.forEach((id) => {
      const room = `admin_${id}`;
      strapi.io.to(room).emit('new-notification', payload);
      strapi.log.info('[notification] Socket emitted to admin room:', room, 'type:', payload?.type);
    });
  }

  /**
   * Get admin users by conceptual role codes (admin, LMadmin, HRadmin).
   *
   * Implementation note:
   * - We fetch all admin users and filter in JS by role name so we don't
   *   depend on the exact shape of the role/roles relation.
   * - Current project roles (from screenshot):
   *     "Admin"       → main admin
   *     "HR admin"    → HR Admin
   *     "LM admin"    → LM Admin
   *     "Super Admin" → super admin
   */
  async function getAdminUsersByRoles(roleCodes) {
    if (!Array.isArray(roleCodes) || roleCodes.length === 0) return [];

    const wantsAdmin = roleCodes.includes('admin');
    const wantsLM = roleCodes.includes('LMadmin');
    const wantsHR = roleCodes.includes('HRadmin');
    if (!wantsAdmin && !wantsLM && !wantsHR) return [];

    let admins = [];
    try {
      admins = await strapi.db.query('admin::user').findMany({
        populate: ['role', 'roles'],
        select: ['id', 'email'],
      });
    } catch (err) {
      strapi.log.error('[notification] getAdminUsersByRoles fetch error:', err?.message || err);
      return [];
    }

    const result = [];
    for (const admin of admins || []) {
      const singleRoleName = admin.role?.name;
      const multiRoleNames = Array.isArray(admin.roles)
        ? admin.roles.map((r) => r?.name).filter(Boolean)
        : [];
      const allNames = [singleRoleName, ...multiRoleNames].filter(Boolean);
      if (allNames.length === 0) continue;

      const hasAdminName = allNames.some((n) => n === 'Admin' || n === 'Super Admin');
      const hasHRName = allNames.some((n) => n === 'HR admin');
      const hasLMName = allNames.some((n) => n === 'LM admin');

      if (
        (wantsAdmin && hasAdminName) ||
        (wantsHR && hasHRName) ||
        (wantsLM && hasLMName)
      ) {
        result.push(admin);
      }
    }
    return result;
  }

  /**
   * Get users by department ID (user.department is string matching dept name)
   */
  async function getUsersByDepartment(departmentId) {
    if (!departmentId) return [];
    try {
      const dept = await strapi.db.query('api::department.department').findOne({
        where: { id: Number(departmentId) },
        select: ['name'],
      });
      if (!dept?.name) return [];
      const users = await strapi.db.query(USER_UID).findMany({
        where: { department: { $eqi: dept.name }, blocked: { $ne: true } },
        select: ['id', 'email'],
      });
      return users || [];
    } catch (err) {
      strapi.log.error('[notification] getUsersByDepartment error:', err?.message || err);
      return [];
    }
  }

  /**
   * Get users by company ID (user.company is enum AIA/Vega)
   */
  async function getUsersByCompany(companyId) {
    if (!companyId) return [];
    try {
      const company = await strapi.db.query('api::company.company').findOne({
        where: { id: Number(companyId) },
        select: ['name'],
      });
      if (!company?.name) return [];
      const users = await strapi.db.query(USER_UID).findMany({
        where: { company: company.name, blocked: { $ne: true } },
        select: ['id', 'email'],
      });
      return users || [];
    } catch (err) {
      strapi.log.error('[notification] getUsersByCompany error:', err?.message || err);
      return [];
    }
  }

  /**
   * Get users by work location ID (user.working_location or user.branch matches location name)
   */
  async function getUsersByWorkLocation(workLocationId) {
    if (!workLocationId) return [];
    try {
      const loc = await strapi.db.query('api::work-location.work-location').findOne({
        where: { id: Number(workLocationId) },
        populate: ['company'],
      });
      if (!loc?.name) return [];
      const companyName = (loc.company?.name || loc.company || '').trim();
      const locName = String(loc.name).trim();
      const where = { blocked: { $ne: true } };
      if (companyName === 'Vega') {
        where.company = 'Vega';
        where.working_location = { $eqi: locName };
      } else {
        where.company = companyName || 'AIA';
        where.branch = { $eqi: locName };
      }
      const users = await strapi.db.query(USER_UID).findMany({
        where,
        select: ['id', 'email'],
      });
      return users || [];
    } catch (err) {
      strapi.log.error('[notification] getUsersByWorkLocation error:', err?.message || err);
      return [];
    }
  }

  /**
   * Main send notification function.
   * - User notifications (toUser): stored for portal bell + email + socket to user.
   * - Admin notifications (admin_user, forRole): stored for Strapi admin bell + email to admin/LM/HR.
   * Targeting: admin gets all; HR gets news_liked; LM gets course-related (feedback, quiz submit, quiz reattempt).
   * @param {string} type - Notification type (enum)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Array} usersArray - Array of user objects { id, email } (portal users)
   * @param {Object} meta - Additional metadata
   * @param {Array} adminRoles - Admin role codes: ['admin','LMadmin','HRadmin']
   * @param {Object} options - { sendEmail: true, sendSocket: true }
   */
  async function sendNotification(type, title, message, usersArray = [], meta = {}, adminRoles = [], options = {}) {
    const { sendEmail: doEmail = true, sendSocket: doSocket = true } = options;
    const users = Array.isArray(usersArray) ? usersArray.filter(Boolean) : [];
    const roles = Array.isArray(adminRoles) ? adminRoles.filter(Boolean) : [];
    const enrichedMeta = await enrichMeta(meta);

    const payload = { type, title, message, meta: enrichedMeta };

    for (const user of users) {
      const userId = user?.id ?? user?.documentId;
      if (!userId) continue;
      try {
        const notification = await strapi.entityService.create(NOTIFICATION_UID, {
          data: {
            type,
            title,
            message,
            is_read: false,
            toUser: userId,
            meta: enrichedMeta,
          },
        });
        if (doEmail && user?.email) {
          await sendEmail(user.email, title, message);
        }
        if (doSocket && strapi.io) {
          triggerSocket([String(userId)], { ...payload, id: notification?.id });
        }
      } catch (err) {
        strapi.log.error('[notification] sendNotification user error:', err?.message || err);
      }
    }

    for (const roleCode of roles) {
      const adminUsers = await getAdminUsersByRoles([roleCode]);
      for (const admin of adminUsers) {
        const adminId = admin?.id ?? admin?.documentId;
        if (!adminId) continue;
        try {
          const notification = await strapi.entityService.create(NOTIFICATION_UID, {
            data: {
              type,
              title,
              message,
              is_read: false,
              admin_user: adminId,
              forRole: roleCode,
              meta: enrichedMeta,
            },
          });
          if (doEmail && admin?.email) {
            await sendEmail(admin.email, title, message);
          }
          if (doSocket && strapi.io) {
            triggerAdminSocket([String(adminId)], { ...payload, id: notification?.id });
          }
        } catch (err) {
          strapi.log.error('[notification] sendNotification admin error:', err?.message || err);
        }
      }
    }
  }

  return {
    sendNotification,
    sendEmail,
    enrichMeta,
    triggerSocket,
    triggerAdminSocket,
    getAdminUsersByRoles,
    getUsersByDepartment,
    getUsersByCompany,
    getUsersByWorkLocation,
  };
};
