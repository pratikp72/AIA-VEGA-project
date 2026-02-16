# Audit Log Plugin

## Overview
Comprehensive audit trail system that automatically tracks all create, update, and delete operations across all content collections in Strapi.

## Features
- ✅ **Automatic Tracking**: Monitors all content changes without manual configuration
- ✅ **Detailed Change History**: Shows which fields were modified with old and new values
- ✅ **Admin User Attribution**: Tracks which admin user made each change
- ✅ **Flexible Filtering**: Filter by date range, collection type, and action type
- ✅ **Default Employee View**: Pre-filtered to show employee collection changes by default
- ✅ **Comprehensive Coverage**: Tracks all API and admin collections except system collections

## What Gets Tracked

### Tracked Collections
- All custom API collections (employees, courses, news, etc.)
- All content types created in Content Manager
- User-permissions users

### Excluded from Tracking
- Admin internal collections (`admin::*`)
- Core Strapi collections (`strapi::*`)
- Upload plugin collections
- i18n collections
- Audit log entries themselves (prevents recursion)

## Data Captured

For each change, the system records:
- **Action**: created, updated, or deleted
- **Collection Name**: Human-readable collection name
- **Content Type UID**: Technical identifier
- **Entry ID**: ID of the modified entry
- **Admin User**: Who made the change
- **Timestamp**: When the change occurred
- **Changed Fields**: For updates - which fields changed and their old/new values
- **Snapshot**: Full data snapshot at time of change

## API Endpoints

### Get Audit Logs
```
GET /api/audit-log/logs
```

Query Parameters:
- `page` - Page number (default: 1)
- `pageSize` - Items per page (default: 25)
- `dateFrom` - Filter start date (ISO format)
- `dateTo` - Filter end date (ISO format)
- `contentType` - Filter by content type UID
- `action` - Filter by action: created, updated, deleted
- `sortBy` - Sort field (default: createdAt)
- `sortOrder` - Sort direction: asc or desc (default: desc)

### Get Available Content Types
```
GET /api/audit-log/content-types
```

Returns list of all tracked collections with display names.

## Usage in Admin Panel

1. Navigate to **Audit Trail** in the admin sidebar
2. Default view shows all recent changes
3. Use filters to narrow down results:
   - **Date Range**: Select from/to dates
   - **Collection**: Choose specific collection or "All Collections"
   - **Action**: Filter by created/updated/deleted

## Database Schema

The plugin creates an `audit_entries` table with:
- `action` - Enum: created, updated, deleted
- `contentType` - String: UID of the collection
- `collectionName` - String: Display name
- `entryId` - Integer: ID of modified entry
- `adminUser` - Relation to admin::user
- `changes` - JSON: Array of field changes
- `snapshot` - JSON: Full entry data
- `createdAt` - Timestamp

## Implementation Details

### Lifecycle Hooks
The plugin uses Strapi's lifecycle hooks system:
- `afterCreate` - Captures new entry creation
- `afterUpdate` - Tracks modifications with field-level diff
- `beforeDelete` - Records deletion with final state snapshot

### Performance Considerations
- Audit logging runs asynchronously to avoid blocking main operations
- Failed audit logs are caught and logged but don't break the main operation
- Large snapshots are stored as JSON (consider cleanup policies for production)

## Installation & Setup

The plugin is already configured in `config/plugins.js`:

```javascript
'audit-log': {
  enabled: true,
  resolve: './src/plugins/audit-log',
}
```

After making any changes to the plugin, rebuild the admin panel:
```bash
npm run build
```

## Future Enhancements

Potential improvements:
- Detailed diff view modal showing exact changes
- Export audit logs to CSV/Excel
- Restore previous versions functionality
- Scheduled cleanup of old audit entries
- Email notifications for critical changes
- Advanced search and filtering
- Change comparison view
