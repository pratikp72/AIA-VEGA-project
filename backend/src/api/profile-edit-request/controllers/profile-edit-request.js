'use strict';

/**
 * profile-edit-request controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::profile-edit-request.profile-edit-request', ({ strapi }) => ({
		async find(ctx) {
			// Populate related fields for table display
			ctx.query = ctx.query || {};
			ctx.query.populate = {
				users_permissions_user: true,
				reviewed_by: true,
				company: true
			};
			return await super.find(ctx);
		},
		async findOne(ctx) {
			ctx.query = ctx.query || {};
			ctx.query.populate = {
				users_permissions_user: true,
				reviewed_by: true,
				company: true
			};
			return await super.findOne(ctx);
		},
	async create(ctx) {
		// Get authenticated user
		const user = ctx.state.user;
		if (!user) {
			return ctx.badRequest('User not authenticated');
		}
		// Fetch user's company (assuming user.company exists)
		const userData = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, { fields: ['company'] });
		if (!userData || !userData.company) {
			return ctx.badRequest('User company not found');
		}
		// Inject company into request body (root field)
		ctx.request.body.data = ctx.request.body.data || {};
		ctx.request.body.data.company = userData.company;
		// Call default create
		return await super.create(ctx);
	},

	async update(ctx) {
		// Get authenticated user
		const user = ctx.state.user;
		if (!user) {
			return ctx.badRequest('User not authenticated');
		}
		// Fetch user's company
		const userData = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, { fields: ['company'] });
		if (!userData || !userData.company) {
			return ctx.badRequest('User company not found');
		}
		ctx.request.body.data = ctx.request.body.data || {};
		ctx.request.body.data.company = userData.company;
		// Call default update
		return await super.update(ctx);
	}
}));
