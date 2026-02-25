'use strict';

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/module-video-progress/mark-read",
      handler: "module-video-progress.markAsRead",
      config: {
        auth: false,
      },
    },
  ],
};