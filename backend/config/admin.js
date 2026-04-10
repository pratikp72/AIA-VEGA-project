module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
  // Custom admin panel configuration
  url: env('ADMIN_URL', '/admin'),

  // Preview: disabled so Content Manager does not 404 when requesting preview URL
  // (e.g. on publish for api::course-assignment.course-assignment). When disabled,
  // the preview endpoint returns 204 with no URL instead of 404.
  preview: {
    enabled: false,
  },
});
