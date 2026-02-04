'use strict';

/**
 * holiday service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::holiday.holiday');
