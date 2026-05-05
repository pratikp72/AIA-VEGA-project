//@ts-nocheck

'use strict';

/**
 * users-permissions plugin extension.
 *
 * Patches the user entity service validation so that an empty or null `email`
 * is accepted (the field is optional for our users).  Strapi's default Yup
 * schema for `email`-type fields generates `.string().email()` without
 * `.nullable()`, which rejects null values even when `required: false`.
 *
 * Strategy: wrap the content-manager update/create routes that Strapi exposes
 * under `/users-permissions/users` to coerce email '' → null before the
 * entity-service layer validates the payload.
 */
module.exports = (plugin) => {
  const originalUpdateUser =
    plugin.controllers?.user?.update?.bind(plugin.controllers.user);
  const originalCreateUser =
    plugin.controllers?.user?.create?.bind(plugin.controllers.user);

  function coerceEmail(ctx) {
    const data = ctx.request?.body;
    if (data && typeof data === 'object') {
      if ('email' in data && (data.email === null || data.email === '')) {
        // Remove the key entirely so Yup's .string() check never sees null
        delete data.email;
      }
    }
  }

  if (originalUpdateUser) {
    plugin.controllers.user.update = async function update(ctx) {
      coerceEmail(ctx);
      return originalUpdateUser(ctx);
    };
  }

  if (originalCreateUser) {
    plugin.controllers.user.create = async function create(ctx) {
      coerceEmail(ctx);
      return originalCreateUser(ctx);
    };
  }

  return plugin;
};
