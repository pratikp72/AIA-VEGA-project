'use strict';

module.exports = {
  async login(ctx) {
    try {
      const body = ctx.request?.body || {};
      const identifier = body.identifier;
      const password = body.password;

      if (!identifier || !password) {
        return ctx.badRequest('identifier and password are required');
      }

      const idStr = String(identifier).trim();

      const userQuery = strapi.db.query('plugin::users-permissions.user');

      // Only allow login by emp_code (AIA) or emp_id (Vega)
      let user =
        // 1) Try by emp_code (AIA)
        (await userQuery.findOne({ where: { emp_code: idStr } })) ||
        // 2) Then by emp_id (Vega)
        (await userQuery.findOne({ where: { emp_id: idStr } }));

      if (!user) {
        return ctx.unauthorized('Invalid credentials');
      }

      // 2) Validate password using users-permissions user service
      const userService = strapi.plugin('users-permissions').service('user');

      const valid = await userService.validatePassword(password, user.password);
      if (!valid) {
        return ctx.unauthorized('Invalid credentials');
      }

      // 3) Issue JWT using users-permissions jwt service
      const jwtService = strapi.plugin('users-permissions').service('jwt');

      const token = jwtService.issue({ id: user.id });

      // 4) Basic sanitization: remove sensitive fields
      const {
        password: _pw,
        resetPasswordToken,
        confirmationToken,
        ...safeUser
      } = user;

      return ctx.send({
        jwt: token,
        user: safeUser,
      });
    } catch (err) {
      strapi.log.error('Custom /auth/login error:', err);
      return ctx.internalServerError('Login failed');
    }
  },
};
