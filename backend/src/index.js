'use strict';

const USER_UID = 'plugin::users-permissions.user';
const COURSE_UID = 'api::course.course';
const { ensureDepartmentForUser } = require('./utils/ensure-department-for-user');
const { syncCourseLanguageComponents } = require('./utils/sync-course-language-components');
const { autoGenerateComponentIds } = require('./utils/auto-generate-component-ids');
const { syncVegaEmployees } = require('./cron-tasks/sync-vega-employees');

function isEmailEnabled() {
  const raw = String(process.env.EMAIL_ENABLED || 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function suppressEmailServiceIfDisabled(strapi) {
  if (isEmailEnabled()) {
    strapi.log.info('[email] EMAIL_ENABLED=true; outgoing emails are enabled.');
    return;
  }

  const serviceFromPluginAccessor = strapi.plugin?.('email')?.service?.('email');
  const serviceFromLegacyAccessor = strapi.plugins?.email?.services?.email;
  const emailServices = [serviceFromPluginAccessor, serviceFromLegacyAccessor].filter(Boolean);

  if (emailServices.length === 0) {
    strapi.log.warn('[email] Email plugin service not found; EMAIL_ENABLED=false guard not applied.');
    return;
  }

  const suppressedResult = { skipped: true, reason: 'EMAIL_ENABLED=false' };

  for (const emailService of emailServices) {
    if (emailService.__emailSuppressionApplied) continue;

    emailService.send = async () => suppressedResult;

    if (typeof emailService.sendTemplatedEmail === 'function') {
      emailService.sendTemplatedEmail = async () => suppressedResult;
    }

    emailService.__emailSuppressionApplied = true;
  }

  strapi.log.info('[email] EMAIL_ENABLED=false; all outgoing emails are suppressed.');
}

module.exports = {
  register({ strapi }) {
    strapi.customFields.register({
      name: 'date-future-only',
      type: 'date',
    });
    strapi.customFields.register({
      name: 'number-range',
      type: 'integer',
    });
    strapi.customFields.register({
      name: 'multi-select-dropdown',
      type: 'json',
    });
    strapi.customFields.register({
      name: 'yes-no-toggle',
      type: 'boolean',
    });
    strapi.customFields.register({
      name: 'workflow-prerequisite-picker',
      type: 'json',
    });

    // When a course is created or updated, sync modules/quiz/feedback_question to match course_language (one entry per language)
    strapi.documents.use(async (context, next) => {
      if (context.uid === COURSE_UID && ['create', 'update'].includes(context.action)) {
        const data = context.params?.data;
        if (data && typeof data === 'object') {
          try {
            syncCourseLanguageComponents(data);
          } catch (err) {
            strapi.log.warn('syncCourseLanguageComponents failed', err);
          }
        }
      }
      return await next();
    });

    // Auto-generate id fields for all components (module_id, quiz_id, question_id, unit_id, route_id, etc.) when missing
    strapi.documents.use(async (context, next) => {
      if (['create', 'update'].includes(context.action)) {
        const data = context.params?.data;
        if (data && typeof data === 'object' && context.uid) {
          try {
            autoGenerateComponentIds(strapi, context.uid, data);
          } catch (err) {
            strapi.log.warn('autoGenerateComponentIds failed', err);
          }
        }
      }
      return await next();
    });

    // When a user is created or updated, ensure a Department entry exists for their department + company
    strapi.documents.use(async (context, next) => {
      const result = await next();
      if (context.uid !== USER_UID || !['create', 'update'].includes(context.action)) {
        return result;
      }
      // Prefer params.data (payload sent) so we don't depend on result shape
      const fromParams = context.params?.data;
      const fromResult = result?.document ?? result;
      const department = fromParams?.department ?? fromResult?.department;
      const company = fromParams?.company ?? fromResult?.company;
      if (!department || !company) return result;
      try {
        await ensureDepartmentForUser(strapi, department, company);
      } catch (err) {
        strapi.log.warn('ensureDepartmentForUser failed', err);
      }
      return result;
    });

    // Course-assignment automation runs from docManager.create (Content Manager) and from db lifecycle (API/fallback).
    // We do not run it here in documents.use to avoid double-running when CM creates.
  },

  bootstrap({ strapi }) {
    suppressEmailServiceIfDisabled(strapi);

    // ── Vega employee sync: run immediately on startup ───────────────────────
    console.log('\n[vega-sync] 🚀 Bootstrap: triggering Vega employee sync on startup...');
    syncVegaEmployees(strapi).catch((err) => {
      console.error(`[vega-sync] ❌ Startup sync failed: ${err?.message || err}`);
      strapi.log.error(`[vega-sync] Startup sync failed: ${err?.message || err}`);
    });
    // ─────────────────────────────────────────────────────────────────────────
    //Force reset when admin changes password
 strapi.db.lifecycles.subscribe({
  models: ['plugin::users-permissions.user'],

  beforeUpdate(event) {
    const { data } = event.params;
    const ctx = strapi.requestContext.get(); // 🔥 important

    console.log("🔥 [User Lifecycle] beforeUpdate");
    console.log("📦 Data:", data);

    if (data.password) {
      // ✅ Detect frontend API call (your changePassword)
      if (ctx?.request?.url?.includes('/change-password')) {
        console.log("👤 Frontend reset detected → keep FALSE");
        return;
      }

      // ✅ Otherwise it's admin panel
      console.log("🔑 Admin password change detected");

      data.is_first_login = true;

      console.log("✅ is_first_login set to TRUE");
    }
  },
});

    strapi.utils = strapi.utils || {};
    strapi.utils.notification = require('./utils/notification')(strapi);

    // ── Socket.io: JWT-based auto-room join ──────────────────────────────────
    try {
      if (strapi.$io) {
        // Verify JWT on every connection and store userId on the socket object
        strapi.$io.server.use(async (socket, next) => {
          try {
            const token = socket.handshake.auth?.token;
            if (!token) return next();
            const jwtService =
              strapi.plugins?.['users-permissions']?.services?.jwt ||
              strapi.plugin?.('users-permissions')?.service?.('jwt');
            if (!jwtService) return next();
            const decoded = await jwtService.verify(token);
            const userId = decoded?.id ?? decoded?._id;
            if (userId) socket.userId = String(userId);
            next();
          } catch {
            next(); // invalid/expired token — allow connection without a room
          }
        });

        strapi.$io.server.on('connection', (socket) => {
          // Auto-join the user's personal room from the JWT-decoded userId
          if (socket.userId) {
            socket.join(`user_${socket.userId}`);
          }

          // Fallback: client can also emit 'join-room' after connect
          socket.on('join-room', (room) => {
            if (
              typeof room === 'string' &&
              (room.startsWith('user_') || room.startsWith('admin_'))
            ) {
              socket.join(room);
            }
          });
        });
      } else {
        strapi.log.warn('[socket] strapi.$io not available — ensure @strapi-community/plugin-io is enabled.');
      }
    } catch (e) {
      strapi.log.error('[socket] Bootstrap failed:', e?.message || e);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // User-progress automation: course-assignment → Not_started; start-course → In_progress; quiz-submission → Completed/Failed
    try {
      const { registerUserProgressLifecycles } = require('./lifecycles/user-progress-automation');
      registerUserProgressLifecycles(strapi);
    } catch (e) {
      strapi.log.error('User-progress automation bootstrap failed:', e?.message || e);
    }

    // Feedback-submission: admin notification when created via Content Manager
    try {
      const { registerFeedbackSubmissionLifecycles } = require('./lifecycles/feedback-submission-notification');
      registerFeedbackSubmissionLifecycles(strapi);
    } catch (e) {
      strapi.log.error('Feedback-submission notification bootstrap failed:', e?.message || e);
    }

    // Quiz reattempt: user notification (bell + email) when admin approves or rejects
    try {
      const { registerQuizReattemptNotificationLifecycles } = require('./lifecycles/quiz-reattempt-notification');
      registerQuizReattemptNotificationLifecycles(strapi);
    } catch (e) {
      strapi.log.error('Quiz reattempt notification bootstrap failed:', e?.message || e);
    }

    // Course-workflow: when module_type is Offline, create one offline_module row per selected user.
    try {
      const { registerCourseWorkflowOfflineModuleSync } = require('./lifecycles/course-workflow-offline-module-sync');
      registerCourseWorkflowOfflineModuleSync(strapi);
    } catch (e) {
      strapi.log.error('Course-workflow offline-module sync bootstrap failed:', e?.message || e);
    }

    // Fallback: ensure department when user is created/updated via Content Manager
    const plugin = strapi.plugin('content-manager');
    if (!plugin) return;
    const docManager = plugin.service('document-manager');
    if (!docManager || typeof docManager.create !== 'function') return;

    const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
    const originalCreate = docManager.create.bind(docManager);
    docManager.create = async (uid, opts = {}) => {
      if (uid === COURSE_UID && opts?.data && typeof opts.data === 'object') {
        try {
          syncCourseLanguageComponents(opts.data);
        } catch (err) {
          strapi.log.warn('syncCourseLanguageComponents (create) failed', err);
        }
      }
      const result = await originalCreate(uid, opts);
      if (uid === USER_UID) {
        const department = opts?.data?.department ?? result?.department;
        const company = opts?.data?.company ?? result?.company;
        if (department && company) {
          try {
            await ensureDepartmentForUser(strapi, department, company);
          } catch (err) {
            strapi.log.warn('ensureDepartmentForUser (create) failed', err);
          }
        }
      }
      // Course-assignment automation runs only from db lifecycle (afterCreate) to avoid duplicate
      // user-progress entries. Do not run here.
      return result;
    };

    const originalUpdate = docManager.update.bind(docManager);
    docManager.update = async (id, uid, opts = {}) => {
      if (uid === COURSE_UID && opts?.data && typeof opts.data === 'object') {
        try {
          syncCourseLanguageComponents(opts.data);
        } catch (err) {
          strapi.log.warn('syncCourseLanguageComponents (update) failed', err);
        }
      }
      const result = await originalUpdate(id, uid, opts);
      if (uid === USER_UID) {
        const department = opts?.data?.department ?? result?.department;
        const company = opts?.data?.company ?? result?.company;
        if (department && company) {
          try {
            await ensureDepartmentForUser(strapi, department, company);
          } catch (err) {
            strapi.log.warn('ensureDepartmentForUser (update) failed', err);
          }
        }
      }
      return result;
    };
  },
};
