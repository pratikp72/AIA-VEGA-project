module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/requests',
        handler: 'profileEditController.getRequests',
        config: {
          policies: [],
        },
      },
      {
        method: 'PUT',
        path: '/requests/:id',
        handler: 'profileEditController.updateStatus',
        config: {
          policies: [],
        },
      },
    ],
  },
};
