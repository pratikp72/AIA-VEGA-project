"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/user-progress/mark-module",
      handler: "user-progress.markModuleRead",
      config: {
        auth: false,
      },
    },
  ],
};