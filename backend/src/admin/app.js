/**
 * Strapi v5 Admin Customization
 * 
 * This file extends the Strapi Admin sidebar without modifying core or Content Manager.
 * It creates a custom menu structure with role-based visibility.
 * 
 * Structure:
 * - Content Manager (visible only to Super Admin)
 * - All Modules (collapsible group, visible to business roles)
 *   ├── HR Module
 *   │   ├── Employees
 *   │   └── Designations
 *   └── Learning Module
 *       ├── Courses
 *       └── Quizzes
 * 
 * Implementation Notes:
 * - Uses app.addMenuLink() API (official Strapi v5 method)
 * - Menu items with 'parent' property create collapsible groups
 * - Role-based visibility is handled through permissions and menu hooks
 */

export default {
  /**
   * Register function - runs when the admin panel initializes
   * This is where we add custom menu links to the sidebar
   * 
   * @param {Object} app - Strapi admin app instance
   */
  register(app) {
    // Custom field: date picker that only allows today or future (e.g. News publish date)
    app.customFields.register({
      name: 'date-future-only',
      type: 'date',
      intlLabel: {
        id: 'app.custom-fields.date-future-only.label',
        defaultMessage: 'Date (today or future only)',
      },
      intlDescription: {
        id: 'app.custom-fields.date-future-only.description',
        defaultMessage: 'Calendar will not allow selecting past dates.',
      },
      components: {
        Input: async () => import('./components/DateFutureOnlyInput').then((m) => ({ default: m.default })),
      },
    });

    // Custom field: number/integer with min, max, integerOnly, positiveOnly (configurable in Content-Type Builder)
    app.customFields.register({
      name: 'number-range',
      type: 'integer',
      intlLabel: {
        id: 'app.custom-fields.number-range.label',
        defaultMessage: 'Number (range / integer / positive)',
      },
      intlDescription: {
        id: 'app.custom-fields.number-range.description',
        defaultMessage: 'Integer with optional min/max. Configure in Base settings when adding the field.',
      },
      components: {
        Input: async () => import('./components/NumberRangeInput').then((m) => ({ default: m.default })),
      },
      options: {
        base: [
          {
            sectionTitle: {
              id: 'app.custom-fields.number-range.section',
              defaultMessage: 'Number range',
            },
            items: [
              {
                intlLabel: { id: 'app.custom-fields.number-range.required', defaultMessage: 'Required' },
                name: 'options.required',
                type: 'checkbox',
                description: 'Field must have a value.',
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.positiveOnly', defaultMessage: 'Positive only (no negative)' },
                name: 'options.positiveOnly',
                type: 'checkbox',
                value: true,
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.integerOnly', defaultMessage: 'Integer only (no decimals)' },
                name: 'options.integerOnly',
                type: 'checkbox',
                value: true,
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.min', defaultMessage: 'Minimum value' },
                name: 'options.min',
                type: 'text',
                description: 'Leave empty for no minimum. Example: 0',
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.max', defaultMessage: 'Maximum value' },
                name: 'options.max',
                type: 'text',
                description: 'Leave empty for no maximum. Example: 100',
              },
            ],
          },
        ],
      },
    });

    /**
     * Add "All Modules" as the parent menu section
     * This creates a collapsible group in the sidebar
     * The 'to' property with '#' makes it non-clickable (just a group header)
     */
    app.addMenuLink({
      id: 'all-modules',
      to: '#all-modules',
      icon: 'apps',
      intlLabel: {
        id: 'custom-menu.all-modules',
        defaultMessage: 'All Modules',
      },
      // Permissions: Only show to business roles (HR, LM, Manager)
      // Super Admin will see Content Manager instead
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: null,
        },
      ],
    });

    /**
     * HR Module - Parent menu item under "All Modules"
     * This creates a sub-group within "All Modules"
     */
    app.addMenuLink({
      id: 'hr-module',
      to: '#hr-module',
      icon: 'briefcase',
      intlLabel: {
        id: 'custom-menu.hr-module',
        defaultMessage: 'HR Module',
      },
      // Set parent to create hierarchy under "All Modules"
      // Strapi automatically handles collapsible behavior
      parent: 'all-modules',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: null,
        },
      ],
    });

    /**
     * Employees - under HR Module
     * Direct link to Content Manager collection type route
     * When clicked, navigates to the Content Manager for employees
     */
    app.addMenuLink({
      id: 'employees',
      to: '/content-manager/collection-types/api::employee.employee',
      icon: 'user',
      intlLabel: {
        id: 'custom-menu.employees',
        defaultMessage: 'Employees',
      },
      // Parent is HR Module, creating nested structure: All Modules > HR Module > Employees
      parent: 'hr-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::employee.employee',
        },
      ],
    });

    /**
     * Designations - under HR Module
     * Redirects to Content Manager designation collection type
     */
    app.addMenuLink({
      id: 'designations',
      to: '/content-manager/collection-types/api::designation.designation',
      icon: 'tag',
      intlLabel: {
        id: 'custom-menu.designations',
        defaultMessage: 'Designations',
      },
      parent: 'hr-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::designation.designation',
        },
      ],
    });

    /**
     * Learning Module - Parent menu item under "All Modules"
     * Another sub-group within "All Modules"
     */
    app.addMenuLink({
      id: 'learning-module',
      to: '#learning-module',
      icon: 'book',
      intlLabel: {
        id: 'custom-menu.learning-module',
        defaultMessage: 'Learning Module',
      },
      parent: 'all-modules',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: null,
        },
      ],
    });

    /**
     * Courses - under Learning Module
     * Redirects to Content Manager course collection type
     */
    app.addMenuLink({
      id: 'courses',
      to: '/content-manager/collection-types/api::course.course',
      icon: 'graduation-cap',
      intlLabel: {
        id: 'custom-menu.courses',
        defaultMessage: 'Courses',
      },
      parent: 'learning-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::course.course',
        },
      ],
    });

    /**
     * Quizzes - under Learning Module
     * Note: Content type is "quizze" (singular) but plural is "quizzes"
     * The route uses the singular form as defined in the schema
     */
    app.addMenuLink({
      id: 'quizzes',
      to: '/content-manager/collection-types/api::quizze.quizze',
      icon: 'question',
      intlLabel: {
        id: 'custom-menu.quizzes',
        defaultMessage: 'Quizzes',
      },
      parent: 'learning-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::quizze.quizze',
        },
      ],
    });
  },

  /**
   * Bootstrap function - runs after register
   * Used for additional setup and menu customization
   * 
   * @param {Object} app - Strapi admin app instance
   */
  bootstrap(app) {
    /**
     * Customize Content Manager menu visibility
     * 
     * In Strapi v5, the Content Manager plugin adds its own menu item.
     * To hide it for non-Super Admins, we need to use menu customization.
     * 
     * Note: The exact API may vary by Strapi version.
     * If modifyMenuLink is not available, configure via role permissions instead.
     */
    
    try {
      // Attempt to modify Content Manager menu link visibility
      // This API may or may not be available depending on Strapi version
      if (typeof app.modifyMenuLink === 'function') {
        app.modifyMenuLink('content-manager', {
          // Add permission check - only Super Admin can see
          permissions: [
            {
              action: 'plugin::content-manager.read',
              subject: null,
            },
          ],
        });
      }
    } catch (error) {
      // If modifyMenuLink is not available, that's okay
      // Visibility will be controlled through role permissions instead
      console.log('Menu modification API not available, using permissions-based visibility');
    }
    
    console.log('Custom Admin Menu Plugin: Menu structure registered');
    console.log('Note: Configure Content Manager visibility via role permissions in Strapi admin');
    console.log('For business roles, revoke general Content Manager permissions');
  },

  /**
   * Config object for admin panel configuration
   */
  config: {
    // Locale configuration - add locales here if needed
    locales: [],
  },
};
