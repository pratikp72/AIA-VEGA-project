'use strict';

/**
 * work-location service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::work-location.work-location');
