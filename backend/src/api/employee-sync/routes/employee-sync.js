'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/employee-sync/trigger',
      handler: 'employee-sync.trigger',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/employee-sync/patch-passwords',
      handler: 'employee-sync.patchPasswords',
      config: { auth: false },
    },
  ],
};
