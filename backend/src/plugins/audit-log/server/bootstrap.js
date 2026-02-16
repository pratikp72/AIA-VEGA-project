module.exports = async ({ strapi }) => {
  // Set up lifecycle hooks ONLY for users-permissions.user
  const USER_UID = 'plugin::users-permissions.user';

  // Subscribe to lifecycle events for user collection only
  [USER_UID].forEach(uid => {
    strapi.db.lifecycles.subscribe({
      models: [uid],
      
      async afterCreate(event) {
        try {
          const { result } = event;
          
          // Get current admin user from request context
          const ctx = strapi.requestContext.get();
          const adminUser = ctx?.state?.user?.id || null;
          
          await strapi.plugin('audit-log').service('auditService').logChange({
            action: 'created',
            contentType: uid,
            entryId: result.id,
            adminUser: adminUser,
            changes: null,
            data: result,
          });
        } catch (error) {
          strapi.log.error('Audit log error (afterCreate):', error);
        }
      },

      async beforeUpdate(event) {
        try {
          const { params } = event;
          const entryId = params.where?.id;
          
          if (entryId) {
            // Fetch the old data before update
            const oldData = await strapi.db.query(uid).findOne({ where: { id: entryId } });
            // Store it in params so we can access it in afterUpdate
            params._oldData = oldData;
          }
        } catch (error) {
          strapi.log.error('Audit log error (beforeUpdate):', error);
        }
      },

      async afterUpdate(event) {
        try {
          const { result, params } = event;
          
          // Get the old data we stored in beforeUpdate
          const oldData = params?._oldData || null;
          const newData = result;
          
          // Calculate changed fields
          const changes = oldData ? getChangedFields(oldData, newData) : null;
          
          // Get current admin user from request context
          const ctx = strapi.requestContext.get();
          const adminUser = ctx?.state?.user?.id || null;

          await strapi.plugin('audit-log').service('auditService').logChange({
            action: 'updated',
            contentType: uid,
            entryId: result.id,
            adminUser: adminUser,
            changes: changes,
            data: result,
          });
        } catch (error) {
          strapi.log.error('Audit log error (afterUpdate):', error);
        }
      },

      async beforeDelete(event) {
        try {
          const { params } = event;
          const entryId = params.where?.id;
          
          if (entryId) {
            // Fetch the entry before deletion to capture its data
            const entry = await strapi.db.query(uid).findOne({ where: { id: entryId } });
            
            // Get current admin user from request context
            const ctx = strapi.requestContext.get();
            const adminUser = ctx?.state?.user?.id || null;
            
            await strapi.plugin('audit-log').service('auditService').logChange({
              action: 'deleted',
              contentType: uid,
              entryId: entryId,
              adminUser: adminUser,
              changes: null,
              data: entry,
            });
          }
        } catch (error) {
          strapi.log.error('Audit log error (beforeDelete):', error);
        }
      },
    });
  });

  strapi.log.info('Audit Log: Tracking user collection (plugin::users-permissions.user)');
};

// Helper function to get changed fields
function getChangedFields(oldData, newData) {
  const changes = [];
  const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  
  // Exclude system fields and relations
  const excludeFields = ['id', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy'];
  
  allKeys.forEach(key => {
    if (excludeFields.includes(key)) return;
    
    const oldValue = oldData?.[key];
    const newValue = newData?.[key];
    
    // Skip if both are objects/arrays (relations) - these need special handling
    if (typeof oldValue === 'object' || typeof newValue === 'object') return;
    
    if (oldValue !== newValue) {
      changes.push({
        field: key,
        from: oldValue,
        to: newValue,
      });
    }
  });
  
  return changes.length > 0 ? changes : null;
}
