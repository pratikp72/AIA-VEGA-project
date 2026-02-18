'use strict';

/**
 * user-progress controller
 *
 * Automatic flow:
 * - Course assigned (course-assignment) → entry created with Not_started (lifecycle).
 * - Frontend calls POST /api/user-progress/start-course → create or update to In_progress.
 * - Quiz submitted (quiz-submission) → entry updated to Completed or Failed (lifecycle).
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::user-progress.user-progress', ({ strapi }) => ({
	/**
	 * POST /api/user-progress/start-course
	 * Body: { userId, courseId }
	 * When user starts the course in the frontend: create entry with In_progress if none,
	 * otherwise update existing entry to In_progress and refresh last_accessed_at.
	 */
	async startCourse(ctx) {
		const { userId, courseId } = ctx.request.body?.data ?? ctx.request.body ?? {};
		if (!userId || !courseId) {
			return ctx.badRequest('userId and courseId are required');
		}
		const uid = 'api::user-progress.user-progress';
		const now = new Date();
		const existing = await strapi.db.query(uid).findOne({
			where: { user: userId, course: courseId },
		});
		if (existing) {
			await strapi.db.query(uid).update({
				where: { id: existing.id },
				data: {
					progress_status: 'In_progress',
					last_accessed_at: now,
				},
			});
			const updated = await strapi.db.query(uid).findOne({ where: { id: existing.id } });
			return ctx.send({ message: 'User progress updated to In progress', progress: updated });
		}
		const entry = await strapi.db.query(uid).create({
			data: {
				user: userId,
				course: courseId,
				progress_status: 'In_progress',
				progress_percentage: 0,
				completed_modules: [],
				started_at: now,
				last_accessed_at: now,
				time_spent_minutes: 0,
				certificate_issued: false,
			},
		});
		// Publish if using draftAndPublish (so analytics findMany status: 'published' sees it)
		const documentId = entry.documentId ?? entry.document_id ?? entry.id;
		if (documentId && typeof strapi.documents(uid).publish === 'function') {
			try {
				await strapi.documents(uid).publish({ documentId });
			} catch (_) {
				// Ignore if already published
			}
		}
		return ctx.send({ message: 'User progress created (In progress)', progress: entry });
	},
}));
