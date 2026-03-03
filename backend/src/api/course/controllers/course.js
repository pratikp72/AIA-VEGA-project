'use strict';

/**
 * course controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

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

    // Get the language filter from query params
    const { language } = ctx.query;
    
    // Call the default core action
    const { data, meta } = await super.find(ctx);

    // Apply language filtering if language parameter is provided
    if (language && data) {
      const filteredData = Array.isArray(data) 
        ? data.map(course => this.filterCourseByLanguage(course, language))
        : this.filterCourseByLanguage(data, language);
      
      return { data: filteredData, meta };
    }

    return { data, meta };
  },

  async findOne(ctx) {
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

    // Get the language filter from query params
    const { language } = ctx.query;

    // Call the default core action
    const { data, meta } = await super.findOne(ctx);

    // Apply language filtering if language parameter is provided
    if (language && data) {
      const filteredData = this.filterCourseByLanguage(data, language);
      return { data: filteredData, meta };
    }

    return { data, meta };
  },
}));
