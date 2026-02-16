'use strict';

/**
 * Seed dummy profile edit request for testing/reference in admin panel
 * 
 * Run: npm run strapi -- scripts:seed-profile-edit-request
 *      or add to package.json scripts and run: npm run seed:profile-edit
 */

module.exports = async () => {
  console.log('Creating dummy profile edit request...');

  try {
    // Find first user (employee)
    const users = await strapi.query('plugin::users-permissions.user').findMany({
      limit: 1,
    });

    if (!users || users.length === 0) {
      console.log('No users found. Please create a user first.');
      return;
    }

    const user = users[0];
    console.log(`Using user: ${user.username} (ID: ${user.id})`);

    // Check if dummy entry already exists
    const existing = await strapi.query('api::profile-edit-request.profile-edit-request').findMany({
      where: {
        reason: { $containsi: 'Dummy entry for testing' }
      },
      limit: 1
    });

    if (existing && existing.length > 0) {
      console.log('✓ Dummy profile edit request already exists (ID: ' + existing[0].documentId + ')');
      return;
    }

    // Sample requested changes - employee wants to update their profile
    const requestedChanges = {
      employee_name: 'John Doe Updated',
      contact_no: '+1-555-0199',
      designation: 'Senior Manager',
      working_location: 'San Francisco Office'
    };

    // Create profile edit request
    const profileEditRequest = await strapi.documents('api::profile-edit-request.profile-edit-request').create({
      data: {
        users_permissions_user: user.id,
        requested_changes: requestedChanges,
        reason: 'Dummy entry for testing - Employee requesting to update contact information after office relocation',
        request_status: 'Pending'
      }
    });

    console.log('✓ Created dummy profile edit request:');
    console.log(`  - Request ID: ${profileEditRequest.documentId}`);
    console.log(`  - Employee: ${user.username}`);
    console.log(`  - Status: Pending`);
    console.log(`  - Requested Changes:`, JSON.stringify(requestedChanges, null, 2));
    console.log('\n✓ You can now view this in the admin panel under "Profile Edit Requests"');

  } catch (error) {
    console.error('Error creating profile edit request:', error.message);
    throw error;
  }
};

