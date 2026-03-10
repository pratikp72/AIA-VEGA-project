module.exports = [
  'global::ensure-department-after-user',
  'global::ensure-work-location-after-user',
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:', 'http:'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      enabled: true,
      headers: '*',
      origin: '*',
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'global::capture-feedback-body',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
