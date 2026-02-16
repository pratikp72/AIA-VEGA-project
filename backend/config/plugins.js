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
  /**
   * Local plugin: Audit Log
   *
   * - Tracks all create, update, delete operations on user/employee collection.
   * - Shows which fields changed with date and action filtering.
   */
  'audit-log': {
    enabled: true,
    resolve: './src/plugins/audit-log',
  },
  /**
   * Local plugin: Quiz Reattempt Requests
   *
   * - Manage quiz reattempt requests from students.
   * - Approve or reject requests with search and filtering.
   */
  'quiz-reattempt-requests': {
    enabled: true,
    resolve: './src/plugins/quiz-reattempt-requests',
  },
  /**
   * Local plugin: Profile Edit Requests
   *
   * - Employee profile edit approval workflow.
   * - HR reviews and approves/rejects profile change requests.
   */
  'profile-edit-requests': {
    enabled: true,
    resolve: './src/plugins/profile-edit-requests',
  },
});

