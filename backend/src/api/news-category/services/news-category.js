'use strict';

/**
 * news-category service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::news-category.news-category');
