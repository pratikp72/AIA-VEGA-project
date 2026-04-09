/**
 * Quiz Reattempt Requests Plugin (Admin)
 *
 * Approve or reject quiz reattempt requests from students.
 */

import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { Question } from '@strapi/icons';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({
      id: PLUGIN_ID,
      name,
    });

    // Quiz Reattempt Requests - sidebar link
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: Question,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: 'Quiz Reattempt Requests',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/QuizReattemptRequests.jsx'),
    });
  },

  bootstrap() {},
  config: {
    locales: [],
  },
};
