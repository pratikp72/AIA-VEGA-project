module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/logs',
        handler: 'auditController.getLogs',
        config: {
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/content-types',
        handler: 'auditController.getContentTypes',
        config: {
          policies: [],
        },
      },
    ],
  },
};
