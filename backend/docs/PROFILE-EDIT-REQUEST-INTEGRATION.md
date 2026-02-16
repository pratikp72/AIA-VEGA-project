# Profile Edit Request - Frontend Integration Guide

## Overview
This system allows employees to request profile edits on the frontend, which must be approved by HR Admin before being applied.

## Backend Setup ✅
- API Collection: `profile-edit-request`
- Plugin: `profile-edit-requests` (HR Admin UI)
- Auto-applies changes on approval

## Frontend Integration

### 1. Create Profile Edit Request (User Action)

```javascript
// When user submits profile edit form
const submitProfileEditRequest = async (userId, changes, reason) => {
  try {
    const response = await fetch('http://localhost:1337/api/profile-edit-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        data: {
          users_permissions_user: userId,
          requested_changes: changes, // Object with field: newValue pairs
          reason: reason,
          request_status: 'Pending',
        }
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to submit profile edit request:', error);
    throw error;
  }
};
```

### 2. Example: User Wants to Change Name & Phone

```javascript
// User fills out form with new values
const handleProfileEditSubmit = async (formData) => {
  const userId = currentUser.id;
  
  // Build changes object with ONLY the fields that changed
  const changes = {};
  if (formData.employee_name !== currentUser.employee_name) {
    changes.employee_name = formData.employee_name;
  }
  if (formData.contact_no !== currentUser.contact_no) {
    changes.contact_no = formData.contact_no;
  }
  if (formData.designation !== currentUser.designation) {
    changes.designation = formData.designation;
  }
  
  // Require a reason
  const reason = formData.reason || "Updating my profile information";
  
  await submitProfileEditRequest(userId, changes, reason);
  
  // Show success message to user
  alert('Your profile edit request has been submitted for HR approval');
};
```

### 3. Check Request Status

```javascript
// Get user's pending/approved/rejected requests
const getMyRequests = async (userId) => {
  try {
    const response = await fetch(
      `http://localhost:1337/api/profile-edit-requests?filters[users_permissions_user][id][$eq]=${userId}&sort=createdAt:desc`,
      {
        headers: {
          'Authorization': `Bearer ${userToken}`,
        }
      }
    );
    
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Failed to fetch requests:', error);
    throw error;
  }
};
```

### 4. UI Example

```jsx
// React component example
import { useState } from 'react';

function ProfileEditRequestForm({ currentUser, userToken }) {
  const [formData, setFormData] = useState({
    employee_name: currentUser.employee_name || '',
    contact_no: currentUser.contact_no || '',
    designation: currentUser.designation || '',
    reason: '',
  });
  
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Build changes object
      const changes = {};
      if (formData.employee_name !== currentUser.employee_name) {
        changes.employee_name = formData.employee_name;
      }
      if (formData.contact_no !== currentUser.contact_no) {
        changes.contact_no = formData.contact_no;
      }
      if (formData.designation !== currentUser.designation) {
        changes.designation = formData.designation;
      }

      if (Object.keys(changes).length === 0) {
        alert('No changes detected');
        setLoading(false);
        return;
      }

      // Submit request
      const response = await fetch('http://localhost:1337/api/profile-edit-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          data: {
            users_permissions_user: currentUser.id,
            requested_changes: changes,
            reason: formData.reason || 'Profile update',
            request_status: 'Pending',
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to submit request');
      }

      alert('✅ Profile edit request submitted! You will be notified when HR reviews it.');
      
      // Optionally reset form or redirect
    } catch (error) {
      console.error('Error:', error);
      alert('❌ Failed to submit request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Name:</label>
        <input
          type="text"
          name="employee_name"
          value={formData.employee_name}
          onChange={handleChange}
        />
      </div>
      
      <div>
        <label>Contact Number:</label>
        <input
          type="text"
          name="contact_no"
          value={formData.contact_no}
          onChange={handleChange}
        />
      </div>
      
      <div>
        <label>Designation:</label>
        <input
          type="text"
          name="designation"
          value={formData.designation}
          onChange={handleChange}
        />
      </div>
      
      <div>
        <label>Reason for changes: *</label>
        <textarea
          name="reason"
          value={formData.reason}
          onChange={handleChange}
          required
          placeholder="Why do you need to update your profile?"
        />
      </div>

      <button type="submit" disabled={loading}>
        {loading ? 'Submitting...' : 'Request Profile Edit'}
      </button>
    </form>
  );
}
```

## HR Admin Workflow

1. HR logs into Strapi admin panel
2. Clicks "Profile Edit Requests" in sidebar
3. Sees list of all requests with:
   - Employee name
   - Fields they want to change
   - Reason
   - Status
4. Clicks "View" to see exact changes
5. Clicks "Approve" or "Reject"
6. **On Approve**: Changes are automatically applied to user profile
7. **On Reject**: Request is marked rejected (user can be notified via webhook/email)

## API Endpoints

### For Frontend Users:
- **POST** `/api/profile-edit-requests` - Create new request
- **GET** `/api/profile-edit-requests?filters[users_permissions_user][id][$eq]={userId}` - Get user's requests

### For HR Admin (Strapi UI):
- **GET** `/profile-edit-requests/requests` - Get all requests (admin only)
- **PUT** `/profile-edit-requests/requests/:id` - Approve/Reject (admin only)

## Permissions Setup

### User Role (Authenticated):
1. Go to Settings → Roles → Authenticated
2. Under "Profile-edit-request":
   - ✅ create
   - ✅ find (to see their own requests)
   - ❌ update (HR only)
   - ❌ delete (HR only)

### Add Filter for Users to See Only Their Requests:
In your frontend, always filter by the current user's ID when fetching requests.

## Requested Changes Format

The `requested_changes` field is a JSON object containing only the fields the employee wants to update. Use the actual field names from the User schema:

**Available Editable Fields:**
- `employee_name` - Full name
- `contact_no` - Contact number (phone)
- `designation` - Job title
- `department` - Department name
- `working_location` - Office location
- `branch` - Branch name
- `description` - Bio/description
- `date_of_birth` - Birth date
- `age` - Age

**Example:**
```json
{
  "requested_changes": {
    "employee_name": "John Smith",
    "contact_no": "+1234567890",
    "designation": "Senior Developer",
    "working_location": "New York Office"
  }
}
```

Only include fields that actually changed. This will be displayed to HR for review before approval.

## Notification (Optional Enhancement)

After HR approves/rejects, you can:
1. Add webhook in Strapi to trigger notification
2. Send email to user about approval status
3. Show in-app notification on user's next login

## Testing Flow

1. **User Side**:
   - Login as employee
   - Fill profile edit form
   - Submit request
   - See "Request submitted" message

2. **Admin Side**:
   - Login to Strapi admin
   - Go to "Profile Edit Requests"
   - See new request with "Pending" status
   - Click "View" to see changes
   - Click "Approve"

3. **Verification**:
   - Check user profile in Content Manager
   - Changes should be applied
   - Request status should be "Approved"
   - reviewed_by and reviewed_at should be populated
