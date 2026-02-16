'use strict';

/**
 * Custom news routes for like/unlike functionality
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/news/:id/like',
      handler: 'news.like',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/news/:id/unlike',
      handler: 'news.unlike',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
