'use strict';

/**
 * feedback-question service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::feedback-question.feedback-question');
