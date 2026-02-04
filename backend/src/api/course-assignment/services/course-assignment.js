'use strict';

/**
 * course-assignment service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::course-assignment.course-assignment');
