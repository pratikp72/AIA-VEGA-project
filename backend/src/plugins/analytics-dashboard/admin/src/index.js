/**
 * Analytics Dashboard Plugin (Admin)
 *
 * Adds Learning Analytics and Overall Analytics dashboards to Strapi Admin.
 * Each dashboard supports Global (all employees) and Personal (single employee) views with filters.
 */

import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { ChartPie, PresentationChart } from '@strapi/icons';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({
      id: PLUGIN_ID,
      name,
    });

    // Learning Analytics - sidebar link
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}/learning`,
      icon: ChartPie,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.learning`,
        defaultMessage: 'Learning Analytics',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/LearningAnalytics/index.jsx'),
    });

    // Overall Analytics - sidebar link
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}/overall`,
      icon: PresentationChart,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.overall`,
        defaultMessage: 'Overall Analytics',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/OverallAnalytics/index.jsx'),
    });
  },

  bootstrap() {},
  config: {
    locales: [],
  },
};
