module.exports = [
  'global::ensure-department-after-user',
  'global::ensure-work-location-after-user',
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: ['http://192.168.2.84:3000', 'http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
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
