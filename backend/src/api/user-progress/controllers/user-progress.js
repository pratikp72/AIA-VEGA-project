'use strict';

/**
 * user-progress controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::user-progress.user-progress', ({ strapi }) => ({
	// Custom endpoint: POST /user-progress/start-course
	async startCourse(ctx) {
		const { userId, courseId } = ctx.request.body;
		if (!userId || !courseId) {
			return ctx.badRequest('userId and courseId are required');
		}
		// Check if entry already exists
		const existing = await strapi.db.query('api::user-progress.user-progress').findOne({
			where: { user: userId, course: courseId },
		});
		if (existing) {
			return ctx.send({ message: 'User progress already exists', progress: existing });
		}
		// Create new user-progress entry
		const entry = await strapi.db.query('api::user-progress.user-progress').create({
			data: {
				user: userId,
				course: courseId,
				progress_status: 'Not_started',
				progress_percentage: 0,
				completed_modules: [],
				started_at: new Date(),
				last_accessed_at: new Date(),
			},
		});
		return ctx.send({ message: 'User progress created', progress: entry });
	},
}));
