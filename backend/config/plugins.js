module.exports = () => ({
  /**
   * Local admin plugin: Modules Sidebar
   *
   * - Adds an "All Modules" sidebar entry for business roles.
   * - Registers an admin permission action: plugin::modules-sidebar.read
   */
  'modules-sidebar': {
    enabled: true,
    resolve: './src/plugins/modules-sidebar',
  },
  /**
   * Local plugin: Analytics Dashboard
   *
   * - Custom analytics API endpoints for Learning & Overall dashboards.
   * - Global + Personal views with filters.
   */
  'analytics-dashboard': {
    enabled: true,
    resolve: './src/plugins/analytics-dashboard',
  },
});

