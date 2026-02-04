# Custom Admin Sidebar - Setup Guide

## Quick Start

1. **Restart Strapi** after adding the custom menu:
   ```bash
   npm run develop
   ```

2. **Configure Role Permissions**:
   - Go to **Settings → Roles** in Strapi admin
   - For **Super Admin**: Keep all Content Manager permissions
   - For **Business Roles** (HR, LM, Manager):
     - Revoke general `Content Manager → Read` permission
     - Grant specific content type permissions only:
       - `api::employee.employee → Read` (for HR role)
       - `api::designation.designation → Read` (for HR role)
       - `api::course.course → Read` (for LM role)
       - `api::quizze.quizze → Read` (for LM role)

## Expected Behavior

### Super Admin
- ✅ Sees **Content Manager** in sidebar
- ✅ Can access all content types through Content Manager
- ❌ Does NOT see "All Modules" (hidden via permissions)

### Business Roles (HR, LM, Manager)
- ❌ Does NOT see **Content Manager** (hidden via permissions)
- ✅ Sees **All Modules** with appropriate sub-items
- ✅ Can access only their assigned content types

## Menu Structure

```
Content Manager (Super Admin only)
  └── [All content types accessible]

All Modules (Business roles)
  ├── HR Module
  │   ├── Employees → /content-manager/collection-types/api::employee.employee
  │   └── Designations → /content-manager/collection-types/api::designation.designation
  │
  └── Learning Module
      ├── Courses → /content-manager/collection-types/api::course.course
      └── Quizzes → /content-manager/collection-types/api::quizze.quizze
```

## Content Type Requirements

Ensure these content types exist:
- ✅ `api::designation.designation` (exists)
- ✅ `api::course.course` (exists)
- ✅ `api::quizze.quizze` (exists)
- ⚠️ `api::employee.employee` (may need to be created)

If `api::employee.employee` doesn't exist:
1. Create it via Content Type Builder, OR
2. Update the route in `src/admin/app.js` to point to an existing content type

## Troubleshooting

### Menu items not appearing
- Check browser console for errors
- Verify user has required permissions
- Restart Strapi: `npm run develop`

### Content Manager still visible to business roles
- Go to **Settings → Roles → [Business Role]**
- Under **Content Manager**, uncheck all general permissions
- Only grant specific content type permissions

### Menu items not redirecting
- Verify content type exists and is accessible
- Check route format: `/content-manager/collection-types/api::{singular}.{singular}`
- Ensure user has read permission for that content type

## Customization

To add more menu items, edit `src/admin/app.js`:

```javascript
app.addMenuLink({
  id: 'new-item-id',
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

## Files Modified

- ✅ `src/admin/app.js` - Main menu configuration
- ✅ `src/admin/README.md` - Detailed documentation
- ✅ `src/admin/SETUP.md` - This setup guide

## No Core Modifications

✅ No changes to:
- `node_modules/`
- Strapi core files
- Content Manager plugin
- Any files outside `src/admin/`

This implementation is **upgrade-safe** and **production-ready**.
