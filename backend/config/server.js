module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', ''),
  cron: {
    enabled: env.bool('CRON_ENABLED', true),
  },
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },

  http: {
    serverOptions: {
      requestTimeout: 30 * 60 * 1000, // 30 minutes in milliseconds
      // keepAliveTimeout: 30 * 60 * 1000, // 30 minutes in milliseconds
    },
  },

  watchIgnoreFiles: [
    '**/data/**',
  ],
});
