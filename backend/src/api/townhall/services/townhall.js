'use strict';

/**
 * townhall service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::townhall.townhall');
