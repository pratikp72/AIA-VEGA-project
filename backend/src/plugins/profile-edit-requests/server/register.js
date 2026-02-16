module.exports = ({ strapi }) => {
  // Register permission for profile edit requests access
  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Access Profile Edit Requests',
      uid: 'read',
      pluginName: 'profile-edit-requests',
    },
  ]);
};
