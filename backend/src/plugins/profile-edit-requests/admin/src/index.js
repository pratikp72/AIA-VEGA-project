/**
 * Profile Edit Requests Plugin (Admin)
 *
 * Approve or reject employee profile edit requests.
 */

import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { User } from '@strapi/icons';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({
      id: PLUGIN_ID,
      name,
    });

    // Profile Edit Requests - sidebar link
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: User,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: 'Profile Edit Requests',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/ProfileEditRequests.jsx'),
    });
  },

  bootstrap() {},
  config: {
    locales: [],
  },
};
