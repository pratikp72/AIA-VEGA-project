module.exports = ({ strapi }) => {
  // Register permission for audit log access
  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Access Audit Log',
      uid: 'read',
      pluginName: 'audit-log',
    },
  ]);
};
