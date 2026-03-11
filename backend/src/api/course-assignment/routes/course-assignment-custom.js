'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/course-assignments/assign',
      handler: 'course-assignment.assign',
      config: {
        policies: [],
      },
    },
  ],
};
