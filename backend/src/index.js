'use strict';

const USER_UID = 'plugin::users-permissions.user';
const COURSE_UID = 'api::course.course';
const { ensureDepartmentForUser } = require('./utils/ensure-department-for-user');
const { syncCourseLanguageComponents } = require('./utils/sync-course-language-components');
const { autoGenerateComponentIds } = require('./utils/auto-generate-component-ids');

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
    strapi.utils = strapi.utils || {};
    strapi.utils.notification = require('./utils/notification')(strapi);

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
