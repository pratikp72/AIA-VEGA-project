'use strict';

const jwt = require('jsonwebtoken');

/**
 * Helper: extracts and verifies the frontend JWT from the Authorization header.
 * Returns the frontend user object (with email), or null if invalid/missing.
 */
async function getVerifiedFrontendUser(ctx) {
  const authHeader = ctx.request.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  try {
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    const decoded = await jwtService.verify(token);
    const userId = decoded?.id;
    if (!userId) return null;

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      select: ['id', 'email'],
    });
    return user || null;
  } catch {
    return null;
  }
}

/**
 * Helper: find an admin panel user by email (case-insensitive).
 * Uses the admin user service in Strapi v5.
 */
async function findAdminUserByEmail(email) {
  try {
    // Strapi v5: use admin user service's findOneByEmail
    const adminUserService = strapi.service('admin::user');
    const adminUser = await adminUserService.findOneByEmail(email.toLowerCase());
    return adminUser || null;
  } catch {
    // Fallback: direct db query
    try {
      return await strapi.db.query('admin::user').findOne({
        where: { email: { $eqi: email } },
        select: ['id', 'email', 'isActive'],
      });
    } catch {
      return null;
    }
  }
}

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

  /**
   * Lightweight check: does the current frontend user have an Administration Panel account?
   * Returns { hasAdminAccess: true/false }. Never returns a token.
   * Route is auth:false — JWT validated manually here.
   */
  async checkAdminAccess(ctx) {
    try {
      const frontendUser = await getVerifiedFrontendUser(ctx);
      if (!frontendUser?.email) {
        return ctx.send({ hasAdminAccess: false });
      }

      const email = String(frontendUser.email).trim().toLowerCase();
      const adminUser = await findAdminUserByEmail(email);

      const hasAdminAccess = !!(adminUser && adminUser.isActive !== false);
      return ctx.send({ hasAdminAccess });
    } catch (err) {
      strapi.log.error('checkAdminAccess error:', err);
      return ctx.send({ hasAdminAccess: false });
    }
  },

  /**
   * Issues a Strapi admin JWT for the matching Administration Panel user.
   * Route is auth:false — JWT validated manually here.
   * Uses jsonwebtoken with ADMIN_JWT_SECRET (Strapi v5 compatible).
   */
  async adminToken(ctx) {
    try {
      const frontendUser = await getVerifiedFrontendUser(ctx);
      if (!frontendUser?.email) {
        return ctx.forbidden('No admin access');
      }

      const email = String(frontendUser.email).trim().toLowerCase();
      const adminUser = await findAdminUserByEmail(email);

      if (!adminUser || adminUser.isActive === false) {
        return ctx.forbidden('No admin access');
      }

      // Strapi v5: issue admin JWT using ADMIN_JWT_SECRET from env
      // This is the same secret Strapi uses internally for admin sessions.
      const adminJwtSecret = String(
        strapi.config.get('admin.auth.secret') ||
        process.env.ADMIN_JWT_SECRET ||
        ''
      );

      if (!adminJwtSecret) {
        strapi.log.error('adminToken: ADMIN_JWT_SECRET is not set');
        return ctx.internalServerError('Server configuration error');
      }

      const adminToken = jwt.sign(
        { id: adminUser.id },
        adminJwtSecret,
        { expiresIn: '1h' }
      );

      return ctx.send({ adminToken });
    } catch (err) {
      strapi.log.error('adminToken error:', err);
      return ctx.internalServerError('Failed to generate admin token');
    }
  },
  /**
   * Serves a tiny HTML page FROM port 1337 that:
   *   1. Sets localStorage["jwtToken"] on the 1337 origin  (same origin as Strapi admin)
   *   2. Immediately redirects the browser to /admin
   *
   * This fixes the cross-origin localStorage problem:
   *   - The Next.js /admin-redirect page (port 3000) can't set localStorage for port 1337
   *   - This endpoint IS on port 1337, so localStorage is shared with the admin panel
   */
  async adminHtmlRedirect(ctx) {
    const token = ctx.query?.token;

    if (!token || typeof token !== 'string') {
      ctx.status = 400;
      ctx.body = '<h1>Bad Request: missing token</h1>';
      return;
    }

    // Sanitize — only allow base64url characters (JWT format)
    const safe = token.replace(/[^A-Za-z0-9\-_\.]/g, '');

    ctx.set('Content-Type', 'text/html; charset=utf-8');
    ctx.set('Cache-Control', 'no-store, no-cache');
    // Override Strapi's helmet CSP — this response intentionally runs inline JS
    // to set localStorage on the 1337 origin before redirecting to /admin.
    ctx.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    ctx.status = 200;
    ctx.body = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Redirecting…</title></head>
<body>
<p>Redirecting to Admin Panel…</p>
<script>
  try {
    localStorage.setItem('jwtToken', '"${safe}"');
    sessionStorage.setItem('jwtToken', '"${safe}"');
  } catch(e) {}
  window.location.replace('/admin');
</script>
</body>
</html>`;
  },
};
