'use strict';

/**
 * course controller
 * List (find) and detail (findOne) are restricted to courses assigned to the logged-in user
 * via course-assignment (Individual, Department, Company, Location).
 * Location: AIA users use branch; Vega users use working_location.
 */

const { createCoreController } = require('@strapi/strapi').factories;

const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';

/**
 * Returns course IDs (numeric) that the user is allowed to see based on active course assignments.
 * Assignment types: Individual (user in list), Department (user.department in assignment departments),
 * Company (user.company in assignment companies), Location (AIA: user.branch, Vega: user.working_location in work_locations).
 */
async function getAssignedCourseIdsForUser(strapi, user) {
  if (!user || user.id == null) return [];
  const userId = Number(user.id);
  const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['id', 'department', 'company', 'branch', 'working_location'],
  });
  if (!fullUser) return [];

  const assignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
    where: { active: true },
    populate: {
      course: true,
      departments: { select: ['name'] },
      companies: { select: ['name'] },
      work_locations: { select: ['name'] },
      individual_user: { select: ['id'] },
    },
  });
  const list = Array.isArray(assignments) ? assignments : [];
  const allowedIds = new Set();

  for (const a of list) {
    const courseId = a.course && (a.course.id ?? a.course.documentId);
    if (courseId == null) continue;

    const targetType = a.assignment_target_type;
    let match = false;

    if (targetType === 'Individual' && Array.isArray(a.individual_user)) {
      match = a.individual_user.some((u) => (u?.id ?? u?.documentId) === userId);
    } else if (targetType === 'Department' && fullUser.department && Array.isArray(a.departments)) {
      const deptNames = (a.departments || []).map((d) => d?.name).filter(Boolean);
      match = deptNames.some((n) => String(n).trim().toLowerCase() === String(fullUser.department).trim().toLowerCase());
    } else if (targetType === 'Company' && fullUser.company && Array.isArray(a.companies)) {
      const companyNames = (a.companies || []).map((c) => c?.name).filter(Boolean);
      match = companyNames.some((n) => String(n).trim().toLowerCase() === String(fullUser.company).trim().toLowerCase());
    } else if (targetType === 'Location' && Array.isArray(a.work_locations)) {
      const locationNames = (a.work_locations || []).map((l) => l?.name).filter(Boolean);
      const userLocation = fullUser.company === 'AIA' ? fullUser.branch : fullUser.working_location;
      if (userLocation && locationNames.length > 0) {
        const uLoc = String(userLocation).trim().toLowerCase();
        match = locationNames.some((n) => String(n).trim().toLowerCase() === uLoc);
      }
    }

    const numId = Number(courseId);
    if (match && Number.isFinite(numId)) allowedIds.add(numId);
  }

  return Array.from(allowedIds);
}

module.exports = createCoreController('api::course.course', ({ strapi }) => ({
  // Helper function to filter course content by language
  filterCourseByLanguage(course, language) {
    if (!language || !course) return course;

    const filteredCourse = { ...course };
    
    // Filter modules by language
    if (filteredCourse.modules && Array.isArray(filteredCourse.modules)) {
      filteredCourse.modules = filteredCourse.modules.filter(
        module => module.language && module.language.toLowerCase() === language.toLowerCase()
      );
    }

    // Filter quiz by language
    if (filteredCourse.quiz && Array.isArray(filteredCourse.quiz)) {
      filteredCourse.quiz = filteredCourse.quiz.filter(
        quiz => quiz.language && quiz.language.toLowerCase() === language.toLowerCase()
      );
    }

    // Filter feedback by language
    if (filteredCourse.feedback && Array.isArray(filteredCourse.feedback)) {
      filteredCourse.feedback = filteredCourse.feedback.filter(
        feedback => feedback.language && feedback.language.toLowerCase() === language.toLowerCase()
      );
    }

    // Filter orientation_detail by language (set to null if doesn't match)
    if (filteredCourse.orientation_detail && filteredCourse.orientation_detail.language) {
      if (filteredCourse.orientation_detail.language.toLowerCase() !== language.toLowerCase()) {
        filteredCourse.orientation_detail = null;
      }
    }

    return filteredCourse;
  },

  async find(ctx) {
    // Require authenticated user; only return courses assigned to this user
    const user = ctx.state?.user;
    if (!user || !user.id) {
      return ctx.unauthorized('You must be logged in to view courses.');
    }

    const assignedIds = await getAssignedCourseIdsForUser(strapi, user);
    const idFilter = assignedIds.length > 0 ? assignedIds : [0]; // empty => no courses

    // Set up populate and restrict to assigned courses only
    ctx.query = {
      ...ctx.query,
      filters: {
        ...(ctx.query.filters || {}),
        id: { $in: idFilter },
      },
      populate: {
        modules: { populate: '*' },
        quiz: {
          populate: {
            quiz_questions: {
              populate: {
                options: true,
                correct_multiSelect_answers: true
              }
            },
            quiz_instruction: true,
            quiz_instruction_checklist: true
          }
        },
        thumbnail: true,
        prerequisite_courses: { fields: ['title'], populate: { thumbnail: true } },
        company: { fields: ['name'] },
        orientation_detail: { populate: '*' },
        feedback: { populate: '*' },
      },
    };

    const { language } = ctx.query;
    const { data, meta } = await super.find(ctx);

    if (language && data) {
      const filteredData = Array.isArray(data)
        ? data.map(course => this.filterCourseByLanguage(course, language))
        : this.filterCourseByLanguage(data, language);
      return { data: filteredData, meta };
    }

    return { data, meta };
  },

  async findOne(ctx) {
    const user = ctx.state?.user;
    if (!user || !user.id) {
      return ctx.unauthorized('You must be logged in to view a course.');
    }

    // Set up populate for all relations and components
    ctx.query = {
      ...ctx.query,
      populate: {
        modules: { populate: '*' },
        quiz: {
          populate: {
            quiz_questions: {
              populate: {
                options: true,
                correct_multiSelect_answers: true
              }
            },
            quiz_instruction: true,
            quiz_instruction_checklist: true
          }
        },
        thumbnail: true,
        prerequisite_courses: { fields: ['title'], populate: { thumbnail: true } },
        company: { fields: ['name'] },
        orientation_detail: { populate: '*' },
        feedback: { populate: '*' },
      },
    };

    const { data, meta } = await super.findOne(ctx);
    if (!data) return { data: null, meta };

    const assignedIds = await getAssignedCourseIdsForUser(strapi, user);
    const courseId = data.id ?? data.documentId;
    if (courseId == null || !assignedIds.includes(Number(courseId))) {
      return ctx.forbidden('You do not have access to this course.');
    }

    const { language } = ctx.query;
    if (language && data) {
      const filteredData = this.filterCourseByLanguage(data, language);
      return { data: filteredData, meta };
    }

    return { data, meta };
  },
}));
