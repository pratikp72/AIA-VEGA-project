'use strict';

/**
 * feedback-submission service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::feedback-submission.feedback-submission');
