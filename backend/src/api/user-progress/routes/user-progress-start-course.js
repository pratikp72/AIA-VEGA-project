'use strict';

/**
 * Custom route: when user starts a course in the frontend.
 * POST /api/user-progress/start-course
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/user-progress/start-course',
      handler: 'user-progress.startCourse',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
