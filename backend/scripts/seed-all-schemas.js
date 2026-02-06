'use strict';

/**
 * Seed data focused on dashboard analytics (filters, charts, date ranges).
 * Re-running with --reset clears analytics data first so entries are not duplicated.
 *
 * Run:  npm run seed:all     (delete all seeded content, then add fresh data)
 *       npm run seed:clear   (only remove all seeded data)
 *       npm run seed:reseed  (only add seed data; does not delete)
 *
 * Analytics dates are spread from 2024-06-01 to 2025-02-04. In dashboard filters use:
 *   Date From: 2024-06-01   Date To: 2025-02-04   to see all data; narrow the range to test filters.
 */

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

const COUNT = 15;

// Analytics date range: spread data so Date From / Date To filters show different results
const ANALYTICS_DATE_START = new Date('2024-06-01T00:00:00.000Z');
const ANALYTICS_DATE_END = new Date('2025-02-04T23:59:59.999Z');
function dateInRange(daysFromStart) {
  const d = new Date(ANALYTICS_DATE_START);
  d.setUTCDate(d.getUTCDate() + daysFromStart);
  if (d > ANALYTICS_DATE_END) return ANALYTICS_DATE_END.toISOString();
  return d.toISOString();
}
function isoDateOnly(daysFromStart) {
  return dateInRange(daysFromStart).slice(0, 10);
}

const SEED_CLEAR_ONLY = process.argv.includes('--clear');
const SEED_ADD_ONLY = process.argv.includes('--add');

// --- Helpers (reuse pattern from seed.js) ---
function getFileSizeInBytes(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

function getFileData(fileName) {
  const filePath = path.join(__dirname, '..', 'data', 'uploads', fileName);
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split('.').pop();
  const mimeType = mime.lookup(ext || '') || 'application/octet-stream';
  return { filepath: filePath, originalFileName: fileName, size, mimetype: mimeType };
}

async function uploadFile(fileInfo, name) {
  const result = await strapi.plugin('upload').service('upload').upload({
    files: fileInfo,
    data: { fileInfo: { alternativeText: name, caption: name, name } },
  });
  return Array.isArray(result) ? result[0] : result;
}

async function getOrUploadImage(fileName = 'default-image.png') {
  const files = await strapi.query('plugin::upload.file').findMany({
    where: { name: { $containsi: fileName.replace(/\.[^.]+$/, '') } },
    limit: 1,
  });
  if (files && files.length > 0) return files[0];
  try {
    const fileData = getFileData(fileName);
    if (fileData.size === 0) return null;
    return await uploadFile(fileData, fileName.replace(/\.[^.]+$/, ''));
  } catch (e) {
    console.warn('Upload image failed:', e?.message);
    return null;
  }
}

async function createAndPublish(uid, data) {
  const doc = await strapi.documents(uid).create({ data });
  if (doc && doc.documentId && strapi.documents(uid).publish) {
    try {
      await strapi.documents(uid).publish({ documentId: doc.documentId });
    } catch (e) {
      console.warn('Publish failed for', uid, e?.message);
    }
  }
  return doc;
}

// Delete in dependency order (children first) so re-seed does not grow counts (e.g. 90 after 6 runs)
async function resetSeedData() {
  const uids = [
    'api::feedback-submission.feedback-submission',
    'api::feedback-question.feedback-question',
    'api::quiz-reattempt-request.quiz-reattempt-request',
    'api::module-video-progress.module-video-progress',
    'api::quiz-submission.quiz-submission',
    'api::user-progress.user-progress',
    'api::activity-log.activity-log',
    'api::notification.notification',
    'api::course-assignment.course-assignment',
    'api::quizze.quizze',
    'api::course.course',
    'api::gallery-item.gallery-item',
    'api::form-template.form-template',
    'api::townhall.townhall',
    'api::holiday.holiday',
    'api::company-policy.company-policy',
    'api::important-link.important-link',
    'api::event.event',
    'api::news.news',
    'api::news-category.news-category',
    'api::unit-location.unit-location',
    'api::department.department',
    'api::city.city',
    'api::company.company',
  ];
  for (const uid of uids) {
    try {
      const { count } = await strapi.db.query(uid).deleteMany({ where: { id: { $gte: 0 } } });
      if (count > 0) console.log('Reset:', uid, count, 'deleted');
    } catch (e) {
      console.warn('Reset', uid, 'failed:', e?.message);
    }
  }
}

async function run() {
  if (SEED_CLEAR_ONLY) {
    console.log('Removing all seeded data...');
    await resetSeedData();
    console.log('Done. Run npm run seed:reseed to add data.');
    return;
  }
  if (!SEED_ADD_ONLY) {
    console.log('Resetting all seeded content (delete then add fresh data)...');
    await resetSeedData();
  } else {
    console.log('Adding seed data (no delete)...');
  }

  const totalDays = Math.max(1, Math.floor((ANALYTICS_DATE_END - ANALYTICS_DATE_START) / 86400000));

  const imageFile = await getOrUploadImage('default-image.png');
  const imageId = imageFile?.id ?? imageFile?.documentId ?? null;

  // --- Users: assign company (AIA/Vega) and department for filter/chart variety ---
  const users = await strapi.db.query('plugin::users-permissions.user').findMany({ limit: 20 });
  const userIds = users.map((u) => u.id ?? u.documentId).filter(Boolean);
  const connectUser = (idx) => {
    if (userIds.length === 0) return undefined;
    const uid = userIds[idx % userIds.length];
    return typeof uid === 'number' ? { connect: [{ id: uid }] } : { connect: [{ documentId: uid }] };
  };
  console.log('Using', userIds.length, 'user(s) for analytics (notifications, activity logs, progress).');

  // --- 1. Company (2: AIA, Vega) - use existing if already present to avoid "unique" publish error ---
  const companyIds = [];
  for (const name of ['AIA', 'Vega']) {
    const existing = await strapi.db.query('api::company.company').findMany({
      where: { name: { $eqi: name } },
      limit: 1,
    });
    if (existing && existing.length > 0) {
      const c = existing[0];
      companyIds.push(c.documentId ?? c.id);
    } else {
      const doc = await createAndPublish('api::company.company', {
        name,
        website: `https://${name.toLowerCase()}.com`,
        address: `${name} HQ, 123 Main St`,
        active: true,
        company_type: 'Corporate',
      });
      if (doc) companyIds.push(doc.documentId || doc.id);
    }
  }
  if (companyIds.length === 0) {
    const existing = await strapi.documents('api::company.company').findMany({ status: 'published', limit: 2 });
    existing.forEach((c) => companyIds.push(c.documentId || c.id));
  }
  console.log('Companies:', companyIds.length);

  const connectCompany = (n) => ({ connect: [{ documentId: companyIds[n % companyIds.length] }] });

  // --- 2. City (COUNT) ---
  const cityIds = [];
  for (let i = 0; i < COUNT; i++) {
    const doc = await createAndPublish('api::city.city', {
      name: `City ${i + 1}`,
      state: `State ${(i % 5) + 1}`,
      country: i % 2 === 0 ? 'India' : 'USA',
      active: true,
      company: connectCompany(i),
    });
    if (doc?.documentId) cityIds.push(doc.documentId);
  }
  console.log('Cities:', cityIds.length);

  // --- 3. Unit-location (COUNT) - uses city (no Area API in this project) ---
  const minimalBusRoute = {
    route_name: 'Seed Route 1',
    route_stops: [{ stop_name: 'Stop 1', bus_sifts: [{ sift_name: 'Shift 1', sift_time: '08:00:00' }] }],
  };
  const unitLocationIds = [];
  for (let i = 0; i < COUNT; i++) {
    try {
      const doc = await createAndPublish('api::unit-location.unit-location', {
        name: `Location ${i + 1}`,
        address: `${i + 1} Industrial Area`,
        contact: `+91 98765${String(i).padStart(5, '0')}`,
        active: true,
        office_location: i % 2 === 0,
        factory_location: i % 2 === 1,
        city: cityIds[i] ? { connect: [{ documentId: cityIds[i] }] } : undefined,
        company: connectCompany(i),
        bus_routes: [minimalBusRoute],
      });
      if (doc?.documentId) unitLocationIds.push(doc.documentId);
    } catch (e) {
      console.warn('Unit-location create failed:', e?.message);
    }
  }
  console.log('Unit locations:', unitLocationIds.length);

  // --- 4. Department (COUNT) ---
  const departmentIds = [];
  const departmentNumericIds = [];
  for (let i = 0; i < COUNT; i++) {
    const doc = await createAndPublish('api::department.department', {
      name: `Department ${i + 1}`,
      active: true,
      company: connectCompany(i),
      unit_locations: unitLocationIds[i]
        ? { connect: [{ documentId: unitLocationIds[i] }] }
        : undefined,
    });
    if (doc?.documentId) departmentIds.push(doc.documentId);
    if (doc?.id != null) departmentNumericIds.push(doc.id);
  }
  console.log('Departments:', departmentIds.length);

  // Assign company (AIA/Vega) and department per user so dashboard filters/charts show variety
  const companiesForFilter = ['AIA', 'Vega'];
  if (userIds.length > 0 && departmentNumericIds.length > 0) {
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (u.id == null) continue;
      const deptIdx = i % departmentNumericIds.length;
      const companyName = companiesForFilter[i % companiesForFilter.length];
      try {
        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: u.id },
          data: {
            department: departmentNumericIds[deptIdx],
            company: companyName,
          },
        });
      } catch (e) {
        console.warn('User company/department update failed:', e?.message);
      }
    }
    console.log('Users assigned to company (AIA/Vega) and departments for analytics filters.');
  }

  // --- 6. News-category (COUNT) ---
  const newsCategoryIds = [];
  for (let i = 0; i < COUNT; i++) {
    const doc = await createAndPublish('api::news-category.news-category', {
      name: `News Category ${i + 1}`,
      active: true,
      company: connectCompany(i),
    });
    if (doc?.documentId) newsCategoryIds.push(doc.documentId);
  }
  console.log('News categories:', newsCategoryIds.length);

  // --- 7. News (COUNT) - requires cover_image ---
  for (let i = 0; i < COUNT; i++) {
    const entry = {
      title: `News Title ${i + 1}`,
      description: `<p>News description for entry ${i + 1}.</p>`,
      active: true,
      visible_on_homepage: i % 3 === 0,
      news_category: newsCategoryIds[i]
        ? { connect: [{ documentId: newsCategoryIds[i] }] }
        : undefined,
      company: connectCompany(i),
      publish_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    };
    if (imageId) entry.cover_image = { connect: [{ id: imageId }] };
    try {
      await createAndPublish('api::news.news', entry);
    } catch (e) {
      console.warn('News create failed:', e?.message);
    }
  }
  console.log('News:', COUNT);

  // --- 8. Event (COUNT) ---
  const start = new Date();
  const end = new Date(Date.now() + 86400000 * 2);
  for (let i = 0; i < COUNT; i++) {
    await createAndPublish('api::event.event', {
      title: `Event ${i + 1}`,
      description: `<p>Event description ${i + 1}.</p>`,
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      event_location: `Venue ${i + 1}`,
      active: true,
      visible_on_homepage: i % 2 === 0,
      company: connectCompany(i),
      event_created_for: 'All',
      event_type: ['Training session', 'Conference', 'Workshop'][i % 3],
    });
  }
  console.log('Events:', COUNT);

  // --- 9. Holiday (COUNT) ---
  for (let i = 0; i < COUNT; i++) {
    const d = new Date(Date.now() + 86400000 * (i + 10));
    await createAndPublish('api::holiday.holiday', {
      title: `Holiday ${i + 1}`,
      date: d.toISOString().slice(0, 10),
      active: true,
      holiday_for: 'All',
      company: connectCompany(i),
    });
  }
  console.log('Holidays:', COUNT);

  // --- 10. Company-policy (COUNT) ---
  for (let i = 0; i < COUNT; i++) {
    await createAndPublish('api::company-policy.company-policy', {
      title: `Policy ${i + 1}`,
      description: `<p>Policy content for policy ${i + 1}.</p>`,
      active: true,
      company: connectCompany(i),
    });
  }
  console.log('Company policies:', COUNT);

  // --- 11. Important-link (COUNT) - icon may be required by custom field ---
  for (let i = 0; i < COUNT; i++) {
    try {
      await createAndPublish('api::important-link.important-link', {
        title: `Important Link ${i + 1}`,
        url: `https://example.com/link-${i + 1}`,
        active: true,
        company: connectCompany(i),
        icon: {}, // custom field may require specific shape; adjust if needed
      });
    } catch (e) {
      console.warn('Important-link create failed (icon?):', e?.message);
    }
  }
  console.log('Important links:', COUNT);

  // --- 12. Notifications (COUNT) - need user (plugin user uses id) ---
  for (let i = 0; i < COUNT; i++) {
    if (userIds.length === 0) break;
    try {
      await createAndPublish('api::notification.notification', {
        type: ['Course_assigned', 'Quiz_passed', 'Quiz_failed', 'Certificate_issued', 'Due_date_reminder'][i % 5],
        title: `Notification ${i + 1}`,
        message: `Message for notification ${i + 1}`,
        is_read: false,
        sent_via_email: false,
        user: connectUser(i),
      });
    } catch (e) {
      console.warn('Notification create failed:', e?.message);
    }
  }
  console.log('Notifications:', COUNT);

  // --- 13. Townhall (COUNT) - meeting_video or meeting_document required ---
  for (let i = 0; i < COUNT; i++) {
    const usePdf = i % 2 === 0;
    const entry = {
      name: `Townhall ${i + 1}`,
      meeting_date: new Date(Date.now() + 86400000 * (i + 5)).toISOString().slice(0, 10),
      description: `<p>Townhall description ${i + 1}.</p>`,
      meeting_content_type: usePdf ? 'Pdf' : 'Video',
      company: connectCompany(i),
      active: true,
    };
    if (imageId) {
      entry.meeting_video = usePdf ? undefined : { connect: [{ id: imageId }] };
      entry.meeting_document = usePdf ? { connect: [{ id: imageId }] } : undefined;
    }
    try {
      await createAndPublish('api::townhall.townhall', entry);
    } catch (e) {
      console.warn('Townhall create failed:', e?.message);
    }
  }
  console.log('Townhalls:', COUNT);

  // --- 14. Course (COUNT) - requires modules (component), description (blocks) ---
  const courseIds = [];
  const minimalModule = {
    title: 'Module 1',
    order: 1,
    module_content_type: 'Text',
    duration_minutes: 10,
    mark_as_read: false,
  };
  for (let i = 0; i < COUNT; i++) {
    try {
      const doc = await createAndPublish('api::course.course', {
        title: `Course ${i + 1}`,
        description: [{ type: 'paragraph', children: [{ type: 'text', text: `Course description ${i + 1}.` }] }],
        duration_hours: (i % 5) + 1,
        active: true,
        passing_score: 60,
        course_category: ['Mandatory', 'Orientation', 'Other'][i % 3],
        course_flow_type: ['course_test_feedback', 'course_test', 'course_feedback', 'course_only'][i % 4],
        modules: [minimalModule],
        company: connectCompany(i),
      });
      if (doc?.documentId) courseIds.push(doc.documentId);
    } catch (e) {
      console.warn('Course create failed:', e?.message);
    }
  }
  console.log('Courses:', courseIds.length);

  // --- 14b. Feedback-question (COUNT) - analytics-centric: one per course, variety of answer types ---
  const feedbackQuestionIds = [];
  const answerTypes = ['Rating', 'Text', 'AgreeOrDisagree', 'YesNo'];
  const minimalFeedbackQuestion = {
    question_id: 'q1',
    qestion: 'How would you rate this course?',
    answer_type: 'Rating',
    mandatory: true,
  };
  for (let i = 0; i < COUNT; i++) {
    const courseId = courseIds[i] || courseIds[0];
    if (!courseId) continue;
    try {
      const doc = await createAndPublish('api::feedback-question.feedback-question', {
        course: { connect: [{ documentId: courseId }] },
        questions: [
          { ...minimalFeedbackQuestion, question_id: `q${i}-1`, qestion: `Feedback Q1 (Course ${i + 1})`, answer_type: answerTypes[i % 4] },
          { question_id: `q${i}-2`, qestion: `Any additional comments?`, answer_type: 'Text', mandatory: false },
        ],
      });
      if (doc?.documentId) feedbackQuestionIds.push(doc.documentId);
    } catch (e) {
      console.warn('Feedback-question create failed:', e?.message);
    }
  }
  console.log('Feedback questions:', feedbackQuestionIds.length);

  // --- 15. Quizze (COUNT) - requires course, questions (component) ---
  const minimalQuestion = {
    question_text: `Sample question ${1}`,
    question_type: 'Multiple_choice',
    order: 1,
    points: 1,
    options: [{ option_key: 'A', option_label: 'Option A' }],
  };
  const quizzeIds = [];
  for (let i = 0; i < COUNT; i++) {
    const courseId = courseIds[i] || courseIds[0];
    if (!courseId) continue;
    try {
      const doc = await createAndPublish('api::quizze.quizze', {
        title: `Quiz ${i + 1}`,
        max_attempts: 3,
        active: true,
        completion_time: 15,
        reattempts: 'One',
        course: { connect: [{ documentId: courseId }] },
        questions: [minimalQuestion],
      });
      if (doc?.documentId) quizzeIds.push(doc.documentId);
    } catch (e) {
      console.warn('Quizze create failed:', e?.message);
    }
  }
  console.log('Quizzes:', quizzeIds.length);

  // --- 15b. Feedback-submission (analytics-centric: multiple per user/course, spread for reporting) ---
  let feedbackSubmissionCount = 0;
  const answerTypesSubmission = ['Rating', 'Text', 'AgreeOrDisagree', 'YesOrNo'];
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let fIdx = 0; fIdx < Math.min(feedbackQuestionIds.length, 10); fIdx++) {
      const courseId = courseIds[fIdx] || courseIds[0];
      const fqId = feedbackQuestionIds[fIdx] || feedbackQuestionIds[0];
      if (!courseId || !fqId || userIds.length === 0) continue;
      try {
        await createAndPublish('api::feedback-submission.feedback-submission', {
          course: { connect: [{ documentId: courseId }] },
          feedback_question: { connect: [{ documentId: fqId }] },
          users_permissions_user: connectUser(uIdx),
          answers: [
            { question_id: `q${fIdx}-1`, question: `Feedback Q1`, answer_type: answerTypesSubmission[(uIdx + fIdx) % 4], answer: (uIdx + fIdx) % 5 <= 2 ? '4' : 'Good' },
            { question_id: `q${fIdx}-2`, question: `Comments`, answer_type: 'Text', answer: `Analytics seed feedback from user ${uIdx + 1} for course ${fIdx + 1}.` },
          ],
        });
        feedbackSubmissionCount++;
      } catch (e) {
        console.warn('Feedback-submission create failed:', e?.message);
      }
    }
  }
  console.log('Feedback submissions (analytics):', feedbackSubmissionCount);

  // --- 15c. Quiz-reattempt-request (analytics-centric: Pending/Approved/Rejected spread, per user/quiz) ---
  const requestStatuses = ['Pending', 'Approved', 'Rejected'];
  let quizReattemptCount = 0;
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let qIdx = 0; qIdx < Math.min(quizzeIds.length, 8); qIdx++) {
      const quizId = quizzeIds[qIdx] || quizzeIds[0];
      const courseId = courseIds[qIdx] || courseIds[0];
      if (!quizId || !courseId || userIds.length === 0) continue;
      try {
        await createAndPublish('api::quiz-reattempt-request.quiz-reattempt-request', {
          quiz: { connect: [{ documentId: quizId }] },
          course: { connect: [{ documentId: courseId }] },
          users_permissions_user: connectUser(uIdx),
          request_status: requestStatuses[(uIdx + qIdx) % 3],
          requested_for_attempt: (qIdx % 3) + 1,
        });
        quizReattemptCount++;
      } catch (e) {
        console.warn('Quiz-reattempt-request create failed:', e?.message);
      }
    }
  }
  console.log('Quiz reattempt requests (analytics):', quizReattemptCount);

  // --- 16. Gallery-item (COUNT) - media_type Image + image required ---
  for (let i = 0; i < COUNT; i++) {
    const entry = {
      title: `Gallery ${i + 1}`,
      media_type: 'Image',
      visibility: true,
      company: connectCompany(i),
    };
    if (imageId) entry.image = { connect: [{ id: imageId }] };
    try {
      await createAndPublish('api::gallery-item.gallery-item', entry);
    } catch (e) {
      console.warn('Gallery-item create failed:', e?.message);
    }
  }
  console.log('Gallery items:', COUNT);

  // --- 18. Form-template (COUNT) - form_type PDF/URL/Excel/Word, description required ---
  for (let i = 0; i < COUNT; i++) {
    const formType = ['PDF', 'URL', 'Excel', 'Word'][i % 4];
    const entry = {
      title: `Form Template ${i + 1}`,
      description: `Form template description ${i + 1}.`,
      form_type: formType,
      active: true,
      company: connectCompany(i),
    };
    if (formType === 'URL') entry.form_url = `https://example.com/form-${i + 1}`;
    else if (imageId) {
      if (formType === 'PDF') entry.form_pdf = { connect: [{ id: imageId }] };
      else if (formType === 'Excel') entry.form_excel = { connect: [{ id: imageId }] };
      else if (formType === 'Word') entry.form_word = { connect: [{ id: imageId }] };
    }
    try {
      await createAndPublish('api::form-template.form-template', entry);
    } catch (e) {
      console.warn('Form-template create failed:', e?.message);
    }
  }
  console.log('Form templates:', COUNT);

  // --- 19. Activity-log (analytics-centric: all types, dates spread for date filter & activity-type filter) ---
  const actTypes = ['News_Reading', 'Event_Info', 'Townhall_Video', 'Townhall_PDF', 'Holiday_View'];
  let activityLogCount = 0;
  for (let i = 0; i < COUNT * 2; i++) {
    if (userIds.length === 0) break;
    const dayOffset = (i * 11) % Math.max(1, totalDays);
    try {
      await strapi.documents('api::activity-log.activity-log').create({
        data: {
          user: connectUser(i),
          company: connectCompany(i),
          activity_type: actTypes[i % actTypes.length],
          activity_description: `Activity ${i + 1} (${actTypes[i % actTypes.length]})`,
          duration_seconds: 30 + (i % 120),
          timestamp: dateInRange(dayOffset),
        },
      });
      activityLogCount++;
    } catch (e) {
      console.warn('Activity-log create failed:', e?.message);
    }
  }
  console.log('Activity logs (analytics):', activityLogCount);

  // --- 20. Course-assignment (to individual users, not department) ---
  let courseAssignmentCount = 0;
  for (let i = 0; i < COUNT; i++) {
    const courseId = courseIds[i] || courseIds[0];
    if (!courseId || userIds.length === 0) continue;
    try {
      await createAndPublish('api::course-assignment.course-assignment', {
        assignment_target_type: 'Individual',
        due_date: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
        active: true,
        course: { connect: [{ documentId: courseId }] },
        individual_user: connectUser(i),
      });
      courseAssignmentCount++;
    } catch (e) {
      console.warn('Course-assignment create failed:', e?.message);
    }
  }
  console.log('Course assignments (individual):', courseAssignmentCount);

  // --- 21. Quiz-submission (analytics-centric: submitted_at spread for date filter) ---
  let quizSubmissionCount = 0;
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let qIdx = 0; qIdx < Math.min(quizzeIds.length, 8); qIdx++) {
      const quizId = quizzeIds[qIdx] || quizzeIds[0];
      if (!quizId) continue;
      const score = 60 + (uIdx + qIdx) % 40;
      const passed = score >= 60;
      const dayOffset = (uIdx * 7 + qIdx * 5) % Math.max(1, totalDays);
      try {
        await createAndPublish('api::quiz-submission.quiz-submission', {
          answers: {},
          score,
          passed,
          attempt_number: (qIdx % 3) + 1,
          submitted_by: connectUser(uIdx),
          quiz: { connect: [{ documentId: quizId }] },
          submitted_at: dateInRange(dayOffset),
        });
        quizSubmissionCount++;
      } catch (e) {
        console.warn('Quiz-submission create failed:', e?.message);
      }
    }
  }
  console.log('Quiz submissions (analytics):', quizSubmissionCount);

  // --- 22. User-progress (analytics-centric: last_accessed_at/completed_at spread for date filters & monthly trend) ---
  const statuses = ['Not_started', 'In_progress', 'Completed', 'Failed'];
  const monthsForCompleted = ['2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02'];
  let userProgressCount = 0;
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 12); cIdx++) {
      const courseId = courseIds[cIdx];
      if (!courseId) continue;
      const status = statuses[(uIdx + cIdx) % 4];
      const isCompleted = status === 'Completed';
      const monthIdx = cIdx % monthsForCompleted.length;
      const completedAt = isCompleted
        ? `${monthsForCompleted[monthIdx]}-${String((uIdx + cIdx) % 28 + 1).padStart(2, '0')}T12:00:00.000Z`
        : null;
      const dayOffset = (uIdx * 20 + cIdx * 5) % Math.max(1, totalDays);
      const lastAccessed = dateInRange(dayOffset);
      try {
        await createAndPublish('api::user-progress.user-progress', {
          user: connectUser(uIdx),
          course: { connect: [{ documentId: courseId }] },
          progress_status: status,
          progress_percentage: isCompleted ? 100 : Math.min(90, (uIdx + cIdx) * 8),
          completed_modules: [],
          last_accessed_at: lastAccessed,
          time_spent_minutes: 10 + (uIdx % 5) * 10 + (cIdx % 3) * 5,
          certificate_issued: isCompleted && cIdx % 2 === 0,
          completed_at: completedAt || undefined,
        });
        userProgressCount++;
      } catch (e) {
        console.warn('User-progress create failed:', e?.message);
      }
    }
  }
  console.log('User progress (analytics):', userProgressCount);

  // --- 23. Module-video-progress (analytics-centric: last_updated spread for date filter, time for charts) ---
  const videoTypes = ['full_watch', 'skipped_to_end', 'in_progress', 'not_started'];
  let moduleVideoCount = 0;
  for (let uIdx = 0; uIdx < userIds.length; uIdx++) {
    for (let cIdx = 0; cIdx < Math.min(courseIds.length, 8); cIdx++) {
      const courseId = courseIds[cIdx];
      if (!courseId) continue;
      for (let mIdx = 0; mIdx < 3; mIdx++) {
        const durationSec = 120 + mIdx * 60;
        const vtype = videoTypes[(uIdx + cIdx + mIdx) % 4];
        const watchedSec = vtype === 'not_started' ? 0 : vtype === 'full_watch' ? durationSec : Math.floor(durationSec * 0.6);
        const dayOffset = (uIdx * 15 + cIdx * 3 + mIdx) % Math.max(1, totalDays);
        try {
          await createAndPublish('api::module-video-progress.module-video-progress', {
            user: connectUser(uIdx),
            course: { connect: [{ documentId: courseId }] },
            module_index: mIdx,
            module_title: `Module ${mIdx + 1}`,
            video_completion_type: vtype,
            time_watched_seconds: watchedSec,
            video_duration_seconds: durationSec,
            last_updated: dateInRange(dayOffset),
          });
          moduleVideoCount++;
        } catch (e) {
          console.warn('Module-video-progress create failed:', e?.message);
        }
      }
    }
  }
  console.log('Module video progress (analytics):', moduleVideoCount);

  console.log('Seed complete.');
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  // Expose Strapi so run() and helpers (createAndPublish, getOrUploadImage, etc.) can use strapi.documents / strapi.db
  global.strapi = app;
  try {
    await run();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
  await app.destroy();
  process.exit(0);
}

main();
