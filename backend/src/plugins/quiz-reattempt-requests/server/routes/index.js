module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/requests/count',
        handler: 'quizReattemptController.getCount',
        config: {
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/requests',
        handler: 'quizReattemptController.getRequests',
        config: {
          policies: [],
        },
      },
      {
        method: 'PUT',
        path: '/requests/:id',
        handler: 'quizReattemptController.updateStatus',
        config: {
          policies: [],
        },
      },
    ],
  },
};
