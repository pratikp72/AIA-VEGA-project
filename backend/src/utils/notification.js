// @ts-nocheck
'use strict';

/**
 * Event-based notification utility for Strapi v5.
 * Centralizes notification logic: DB + email + socket.io.
 * Use via: strapi.utils.notification.sendNotification(...)
 */

module.exports = (strapi) => {
  const NOTIFICATION_UID = 'api::notification.notification';
  const USER_UID = 'plugin::users-permissions.user';

  function isEmailEnabled() {
    const raw = String(process.env.EMAIL_ENABLED || 'false').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  }

  /**
   * Enrich meta with human-readable names (userName, courseTitle, newsTitle)
   * so the admin UI can show friendly labels without extra API calls.
   */
  async function enrichMeta(meta = {}) {
    /** @type {Record<string, any>} */
    const out = { ...(meta || {}) };

    // Resolve userName from userId (portal user: username, email)
    if (out.userId != null && out.userId !== '' && !out.userName) {
      try {
        const userRow = await strapi.db.query(USER_UID).findOne({
          where: { id: Number(out.userId) },
          select: ['id', 'username', 'email'],
        });
        if (userRow) {
          out.userName =
            userRow.username ||
            userRow.email ||
            `User ${userRow.id}`;
        }
      } catch (err) {
        strapi.log.warn('[notification] enrichMeta user error:', err?.message || err);
      }
    }

    // Resolve courseTitle, company, courseDocumentId from courseId (numeric id or documentId)
    if (out.courseId != null && out.courseId !== '') {
      try {
        const courseId = Number(out.courseId);
        let courseRow = null;
        if (!Number.isNaN(courseId)) {
          courseRow = await strapi.db.query('api::course.course').findOne({
            where: { id: courseId },
            populate: ['company'],
          });
        }
        if (!courseRow && String(out.courseId)) {
          courseRow = await strapi.db.query('api::course.course').findOne({
            where: { documentId: String(out.courseId) },
            populate: ['company'],
          });
        }
        if (courseRow?.title && !out.courseTitle) {
          out.courseTitle = courseRow.title;
        }
        if (courseRow?.documentId && !out.courseDocumentId) {
          out.courseDocumentId = courseRow.documentId;
        }
        if (!out.company && courseRow) {
          const companies = Array.isArray(courseRow.company)
            ? courseRow.company
            : courseRow.company
              ? [courseRow.company]
              : [];
          if (companies[0]?.name) out.company = companies[0].name;
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
   * Build a rich HTML email for portal user notifications.
   * Colors match the AIA-VEGA portal theme: primary #9C2EDB, dark #080808.
   */
  function buildUserEmailHtml(type, title, message, meta = {}) {
    const courseTitle = meta.courseTitle || (meta.courseId ? `Course #${meta.courseId}` : null);
    const userName = meta.userName || null;

    // Theme tokens (mirrors globals.css)
    const PRIMARY       = '#9C2EDB';
    const PRIMARY_LIGHT = '#F4E2FF';
    const PRIMARY_DARK  = '#7a1fa8';
    const DARK          = '#080808';
    const SUCCESS       = '#22C55E';
    const SUCCESS_LIGHT = '#F0FDF4';
    const ERROR         = '#EF4444';
    const ERROR_LIGHT   = '#FEE2E2';
    const GRAY_BG       = '#F3F4F6';
    const GRAY_TEXT     = '#585858';
    const BODY_TEXT     = '#1f1f1f';

    const greeting = `<p style="font-size:15px;color:${BODY_TEXT};margin:0 0 14px;">Hello${userName ? `, <strong>${userName}</strong>` : ''},</p>`;

    const courseChip = (accentColor, bgColor) => courseTitle
      ? `<div style="background:${bgColor};border-left:4px solid ${accentColor};border-radius:8px;padding:14px 18px;margin:20px 0;">
           <p style="margin:0;font-size:14px;color:${BODY_TEXT};"><span style="color:${GRAY_TEXT};font-size:12px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Course</span></p>
           <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:${DARK};">${courseTitle}</p>
         </div>`
      : '';

    let bodyContent = '';

    if (type === 'course_assigned') {
      bodyContent = `
        ${greeting}
        <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
          A new course has been assigned to you on the <strong style="color:${PRIMARY};">AIA-VEGA Learning Portal</strong>.
        </p>
        <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">Please log in to the portal and begin your learning journey. Complete the course before the due date to stay on track with your development goals.</p>
        <div style="margin:24px 0;">
          <a href="#" style="display:inline-block;background:${PRIMARY};color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.3px;">Start Course →</a>
        </div>
        <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">If you have any questions, please reach out to your Learning &amp; Development team.</p>
      `;
    } else if (type === 'quiz_reattempt_approved') {
      bodyContent = `
        ${greeting}
        <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
          Great news! Your quiz reattempt request has been <strong style="color:${SUCCESS};">approved</strong>.
        </p>
        ${courseChip(SUCCESS, SUCCESS_LIGHT)}
        <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">You can now log back in to the portal and reattempt the quiz. We recommend reviewing the course material thoroughly before your next attempt to improve your score.</p>
        <div style="margin:24px 0;">
          <a href="#" style="display:inline-block;background:${PRIMARY};color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.3px;">Reattempt Quiz →</a>
        </div>
        <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">Best of luck! If you need any support, please contact the Learning &amp; Development team.</p>
      `;
    } else if (type === 'quiz_reattempt_rejected') {
      bodyContent = `
        ${greeting}
        <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
          We regret to inform you that your quiz reattempt request has been <strong style="color:${ERROR};">rejected</strong>.
        </p>
        ${courseChip(ERROR, ERROR_LIGHT)}
        <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">If you believe this decision was made in error or would like further clarification, please reach out to your Learning &amp; Development team or your line manager.</p>
        <p style="font-size:13px;color:${GRAY_TEXT};margin:10px 0;">You may submit a new reattempt request after <strong>24 hours</strong> from the time of this notification.</p>
        <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">We appreciate your commitment to learning and encourage you to continue your progress.</p>
      `;
    } else if (type === 'course_unassigned') {
      bodyContent = `
        ${greeting}
        <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
          Your enrollment for the following course on the <strong style="color:${PRIMARY};">AIA-VEGA Learning Portal</strong> has been updated.
        </p>
        ${courseChip(ERROR, ERROR_LIGHT)}
        <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">
          You are no longer eligible for this course. This may be due to a change in your assignment or training plan.
          If you believe this is an error or need further clarification, please reach out to your Learning &amp; Development team or your line manager.
        </p>
        <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">We appreciate your commitment to learning and development.</p>
      `;
    } else {
      bodyContent = `${greeting}<p style="font-size:15px;color:${BODY_TEXT};margin:0;">${message}</p>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${GRAY_BG};font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GRAY_BG};padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- Top logo bar -->
        <tr>
          <td style="background:${DARK};padding:20px 32px;border-radius:12px 12px 0 0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;">AIA <span style="color:${PRIMARY};font-weight:300;">|</span> VEGA</p>
                  <p style="margin:2px 0 0;font-size:11px;color:#aaaaaa;letter-spacing:1.5px;text-transform:uppercase;">Learning Portal</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Purple accent stripe -->
        <tr>
          <td style="background:${PRIMARY};padding:0;height:4px;"></td>
        </tr>

        <!-- Title bar -->
        <tr>
          <td style="background:#ffffff;padding:22px 32px 0;border-top:none;">
            <p style="margin:0;font-size:20px;font-weight:700;color:${DARK};">${title}</p>
            <div style="width:40px;height:3px;background:${PRIMARY};border-radius:2px;margin:8px 0 0;"></div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px 32px;">
            ${bodyContent}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:18px 32px;border-top:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;line-height:1.6;">
              This is an automated message from the <strong>AIA-VEGA Learning Portal</strong>.<br>
              Please do not reply to this email. For assistance, contact your HR or L&amp;D team.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /**
   * Send email via Strapi email plugin (Nodemailer).
   * Requires .env: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, EMAIL_FROM
   */
  async function sendEmail(to, subject, body, htmlOverride) {
    if (!to || !subject) {
      console.log(`[EMAIL] ❌ Skipped — missing to="${to}" or subject="${subject}"`);
      return;
    }

    const emailEnabled = isEmailEnabled();
    console.log(`[EMAIL] EMAIL_ENABLED env="${process.env.EMAIL_ENABLED}" → resolved=${emailEnabled}`);

    if (!emailEnabled) {
      console.log(`[EMAIL] ❌ Blocked — EMAIL_ENABLED is false. Set EMAIL_ENABLED=true in .env to send emails.`);
      strapi.log.warn(`[notification.sendEmail] Email blocked: EMAIL_ENABLED=false (to: ${to})`);
      return;
    }

    console.log(`[EMAIL] 📤 Attempting to send email:`);
    console.log(`[EMAIL]   → To:      ${to}`);
    console.log(`[EMAIL]   → Subject: ${subject}`);
    console.log(`[EMAIL]   → SMTP:    ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
    console.log(`[EMAIL]   → From:    ${process.env.EMAIL_FROM}`);

    const text = body || '';
    const html = htmlOverride || (text ? text.replace(/\n/g, '<br>') : '');
    const payload = {
      to,
      subject,
      ...(text && { text }),
      ...(html && { html }),
    };
    if (!payload.text && !payload.html) payload.text = '(No content)';

    const emailService =
      strapi.plugin?.('email')?.service?.('email') ||
      strapi.plugins?.email?.services?.email;

    if (!emailService || typeof emailService.send !== 'function') {
      console.log(`[EMAIL] ❌ Email plugin service not found — check config/plugins.js and EMAIL_ENABLED in .env`);
      strapi.log.warn('[notification] Email plugin not available – skipping send. Enable email in config/plugins.js and set SMTP_* in .env');
      return;
    }

    try {
      await emailService.send(payload);
      console.log(`[EMAIL] ✅ Email sent successfully to: ${to}`);
    } catch (err) {
      const msg = err?.message || String(err);
      console.log(`[EMAIL] ❌ Email send FAILED to: ${to}`);
      console.log(`[EMAIL]   → Error: ${msg}`);
      if (/ECONNREFUSED/i.test(msg)) {
        console.log(`[EMAIL]   → HINT: Cannot connect to SMTP server. Check SMTP_HOST (${process.env.SMTP_HOST}) and SMTP_PORT (${process.env.SMTP_PORT}) are correct and reachable.`);
      } else if (/ETIMEDOUT/i.test(msg)) {
        console.log(`[EMAIL]   → HINT: Connection timed out. The SMTP server may be unreachable from this machine.`);
      } else if (/auth|credentials|login|Invalid login/i.test(msg)) {
        console.log(`[EMAIL]   → HINT: Authentication failed. Check SMTP_USERNAME and SMTP_PASSWORD in .env`);
      }
      strapi.log.error('[notification] Email send failed:', msg);
    }
  }

  /**
   * Emit socket.io event to target user(s)
   */
  function triggerSocket(userIds, payload) {
    const io = strapi.$io;
    if (!io) {
      strapi.log.warn('[notification] Socket skipped: strapi.$io not available');
      return;
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      strapi.log.warn('[notification] Socket skipped: no userIds provided');
      return;
    }
    const ids = userIds.filter(Boolean).map(String);
    ids.forEach((id) => {
      const room = `user_${id}`;
      io.server.to(room).emit('new-notification', payload);
    });
  }

  /**
   * Emit socket.io event to admin user(s)
   */
  function triggerAdminSocket(adminIds, payload) {
    const io = strapi.$io;
    if (!io) {
      strapi.log.warn('[notification] Admin socket skipped: strapi.$io not available');
      return;
    }
    if (!Array.isArray(adminIds) || adminIds.length === 0) {
      strapi.log.warn('[notification] Admin socket skipped: no adminIds provided');
      return;
    }
    const ids = adminIds.filter(Boolean).map(String);
    ids.forEach((id) => {
      const room = `admin_${id}`;
      io.server.to(room).emit('new-notification', payload);
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

    const normalizedRoleCodes = roleCodes
      .map((r) => String(r || '').trim().toLowerCase())
      .filter(Boolean);

    const wantsAdmin = normalizedRoleCodes.some((c) => c === 'admin' || c.includes('super'));
    const wantsLM = normalizedRoleCodes.some((c) => c.includes('lm'));
    const wantsHR = normalizedRoleCodes.some((c) => c.includes('hr'));
    if (!wantsAdmin && !wantsLM && !wantsHR) return [];

    try {
      // Step 1: Fetch all admin roles to find matching IDs (reliable - no name guessing)
      const allRoles = await strapi.db.query('admin::role').findMany({
        select: ['id', 'name', 'code'],
      });
      strapi.log.info('[notification] all admin roles: ' + JSON.stringify(allRoles));

      const matchedRoleIds = [];
      for (const role of allRoles || []) {
        const n = String(role.name || '').trim().toLowerCase();
        const c = String(role.code || '').trim().toLowerCase();
        const isAdminRole = wantsAdmin && (n === 'admin' || n.includes('super') || c.includes('super'));
        const isLMRole = wantsLM && n.includes('lm');
        const isHRRole = wantsHR && n.includes('hr');
        if (isAdminRole || isLMRole || isHRRole) {
          matchedRoleIds.push(role.id);
        }
      }

      strapi.log.info('[notification] matched role IDs for ' + JSON.stringify(roleCodes) + ': ' + JSON.stringify(matchedRoleIds));

      if (matchedRoleIds.length === 0) {
        strapi.log.warn('[notification] no matching roles found for codes: ' + JSON.stringify(roleCodes));
        return [];
      }

      // Step 2: Fetch all admin users with their roles populated, then filter by role ID
      const allAdmins = await strapi.db.query('admin::user').findMany({
        populate: ['roles'],
        select: ['id', 'email'],
      });

      const result = (allAdmins || []).filter((admin) => {
        const userRoleIds = (admin.roles || []).map((r) => r?.id).filter(Boolean);
        return userRoleIds.some((id) => matchedRoleIds.includes(id));
      });

      if (result.length === 0) {
        strapi.log.warn('[notification] no admin users matched roles: ' + JSON.stringify(roleCodes));
      } else {
        strapi.log.info('[notification] admin recipients for ' + JSON.stringify(roleCodes) + ': ' + JSON.stringify(result.map((u) => ({ id: u?.id, email: u?.email }))));
      }

      return result;
    } catch (err) {
      strapi.log.error('[notification] getAdminUsersByRoles error: ' + (err?.message || String(err)));
      return [];
    }
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
   * Build a readable email body for admin notifications (includes user/course/news context from meta).
   */
  function buildAdminEmailBody(title, message, meta = {}) {
    const lines = [title, '', message];
    if (meta.userName != null || meta.userId != null) {
      lines.push('', `User: ${meta.userName || `ID ${meta.userId}`}`);
    }
    if (meta.courseTitle != null || meta.courseId != null) {
      lines.push(`Course: ${meta.courseTitle || `ID ${meta.courseId}`}`);
    }
    if (meta.newsTitle != null || meta.newsId != null) {
      lines.push(`News: ${meta.newsTitle || meta.newsId}`);
    }
    return lines.join('\n');
  }

  /**
   * Main send notification function.
   * - User notifications (toUser): stored for portal bell + email + socket to user.
   * - Admin notifications (admin_user, forRole): stored for Strapi admin bell + email to admin/LM/HR.
   * Targeting: admin gets all; HR gets news_liked; LM gets course-related (feedback, quiz submit, quiz reattempt).
   * Admin emails are always sent when adminRoles are provided (sendEmail option applies to both user and admin).
   * @param {string} type - Notification type (enum)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Array} usersArray - Array of user objects { id, email } (portal users)
   * @param {Object} meta - Additional metadata
   * @param {Array} adminRoles - Admin role codes: ['admin','LMadmin','HRadmin']
   * @param {Object} options - { sendEmail: true, sendSocket: true }
   *   Email is sent only when options.sendEmail is true AND process.env.EMAIL_ENABLED is true.
   *   In-app (DB) and socket delivery are independent of EMAIL_ENABLED.
   */
  async function sendNotification(type, title, message, usersArray = [], meta = {}, adminRoles = [], options = {}) {
    const { sendEmail: doEmail = true, sendSocket: doSocket = true } = options;
    const globalEmailEnabled = isEmailEnabled();
    const shouldSendEmail = doEmail && globalEmailEnabled;
    console.log(`[NOTIFICATION] 🔔 sendNotification called`);
    console.log(`[NOTIFICATION]   → type:         ${type}`);
    console.log(`[NOTIFICATION]   → title:        ${title}`);
    console.log(`[NOTIFICATION]   → users:        ${usersArray.length}`);
    console.log(`[NOTIFICATION]   → adminRoles:   ${JSON.stringify(adminRoles)}`);
    console.log(`[NOTIFICATION]   → emailEnabled: ${globalEmailEnabled}, willSendEmail: ${shouldSendEmail}`);
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
        if (shouldSendEmail && user?.email) {
          const htmlBody = buildUserEmailHtml(type, title, message, enrichedMeta);
          await sendEmail(user.email, title, message, htmlBody);
        }
        if (doSocket && strapi.$io) {
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
          if (shouldSendEmail && admin?.email) {
            const emailBody = buildAdminEmailBody(title, message, enrichedMeta);
            await sendEmail(admin.email, title, emailBody);
          }
          if (doSocket && strapi.$io) {
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
    isEmailEnabled,
    enrichMeta,
    triggerSocket,
    triggerAdminSocket,
    getAdminUsersByRoles,
    getUsersByDepartment,
    getUsersByCompany,
    getUsersByWorkLocation,
  };
};
