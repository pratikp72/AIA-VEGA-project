# Custom Admin Sidebar Menu Plugin

This plugin extends the Strapi v5 Admin sidebar with a custom menu structure without modifying core or Content Manager.

## Structure

```
Content Manager   (visible only to Super Admin)

All Modules
├── HR Module
│   ├── Employees → /admin/content-manager/collection-types/api::employee.employee
│   ├── Designations → /admin/content-manager/collection-types/api::designation.designation
│
├── Learning Module
│   ├── Courses → /admin/content-manager/collection-types/api::course.course
│   ├── Quizzes → /admin/content-manager/collection-types/api::quizze.quizze
```

## Features

- ✅ Custom menu structure with collapsible groups
- ✅ Menu items redirect to Content Manager routes
- ✅ Role-based visibility (configured via permissions)
- ✅ No modifications to Strapi core or Content Manager
- ✅ Upgrade-safe implementation

## Role-Based Visibility Setup

### Content Manager (Super Admin Only)

To hide Content Manager from non-Super Admin users:

1. Go to **Settings → Roles → [Role Name]**
2. For business roles (HR, LM, Manager), **revoke** the following permissions:
   - `Content Manager → Read` (general)
   - Or configure specific content type permissions

3. **Super Admin** role should have all Content Manager permissions enabled

### All Modules (Business Roles)

The "All Modules" menu and its sub-items are visible to users who have:
- `Content Manager → Read` permission
- Or specific content type read permissions

## Configuration

### Adding New Menu Items

Edit `src/admin/app.js` and add new menu links:

```javascript
app.addMenuLink({
  id: 'new-item',
  to: '/content-manager/collection-types/api::content-type.content-type',
  icon: 'icon-name',
  intlLabel: {
    id: 'custom-menu.new-item',
    defaultMessage: 'New Item',
  },
  parent: 'parent-module-id', // Optional: for nested items
  permissions: [
    {
      action: 'plugin::content-manager.read',
      subject: 'api::content-type.content-type',
    },
  ],
});
```

### Content Type Routes

Menu items redirect to Content Manager using the format:
```
/content-manager/collection-types/api::{singular-name}.{singular-name}
```

Example:
- `api::employee.employee` → `/content-manager/collection-types/api::employee.employee`
- `api::course.course` → `/content-manager/collection-types/api::course.course`

## Icons

Strapi uses Font Awesome icons. Common icons:
- `apps` - Applications/Modules
- `briefcase` - HR/Business
- `book` - Learning/Education
- `user` - Users/Employees
- `tag` - Tags/Categories
- `graduation-cap` - Courses
- `question` - Quizzes/Questions

See [Strapi Icons Documentation](https://strapi.io/documentation/developer-docs/latest/development/admin-customization.html#available-icons) for full list.

## Troubleshooting

### Menu items not showing

1. Check user permissions in **Settings → Roles**
2. Verify content types exist (e.g., `api::employee.employee`)
3. Restart Strapi after changes: `npm run develop`

### Content Manager still visible to business roles

1. Go to **Settings → Roles → [Business Role]**
2. Revoke `Content Manager → Read` permission
3. Grant only specific content type permissions (e.g., `api::employee.employee → Read`)

### Menu items not redirecting

1. Verify the content type route format is correct
2. Check browser console for errors
3. Ensure Content Manager plugin is enabled

## Notes

- This plugin does NOT modify Strapi core or node_modules
- All changes are in `src/admin/app.js`
- Menu structure is upgrade-safe and compatible with Strapi v5
- Content Manager functionality remains unchanged
