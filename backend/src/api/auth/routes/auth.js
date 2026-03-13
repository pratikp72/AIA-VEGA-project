'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/auth/login',
      handler: 'auth.login',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/auth/check-admin-access',
      handler: 'auth.checkAdminAccess',
      config: {
        auth: false, // JWT validated manually inside controller
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/auth/admin-token',
      handler: 'auth.adminToken',
      config: {
        auth: false, // JWT validated manually inside controller
        policies: [],
        middlewares: [],
      },
    },
  ],
};
