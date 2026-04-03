'use strict';

/**
 * profile-edit-request controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const ALLOWED_PROFILE_FIELDS = [
	'username',
	'employee_name',
	'email',
	'contact_no',
	'designation',
	'department',
	'working_location',
	'branch',
	'date_of_birth',
	'joining_date',
	'age',
];

/**
 * @param {Record<string, unknown> | null | undefined} changes
 */
function sanitizeRequestedChanges(changes) {
	if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
		return {};
	}

	/** @type {Record<string, unknown>} */
	const filtered = {};
	for (const [key, value] of Object.entries(changes)) {
		if (ALLOWED_PROFILE_FIELDS.includes(key)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

module.exports = createCoreController('api::profile-edit-request.profile-edit-request', ({ strapi }) => ({
	async find(ctx) {
		// Populate related fields for table display
		ctx.query = ctx.query || {};
		ctx.query.populate = {
			users_permissions_user: true,
			reviewed_by: true,
			company: true,
		};
		return await super.find(ctx);
	},

	async findOne(ctx) {
		ctx.query = ctx.query || {};
		ctx.query.populate = {
			users_permissions_user: true,
			reviewed_by: true,
			company: true,
		};
		return await super.findOne(ctx);
	},

	async create(ctx) {
		const user = ctx.state.user;
		if (!user) {
			return ctx.unauthorized('User not authenticated');
		}

		const userData = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
			fields: ['company'],
		});

		if (!userData || !userData.company) {
			return ctx.badRequest('User company not found');
		}

		const bodyData = (ctx.request.body && ctx.request.body.data) || {};
		const filteredChanges = sanitizeRequestedChanges(bodyData.requested_changes);

		if (Object.keys(filteredChanges).length === 0) {
			return ctx.badRequest('requested_changes must include at least one allowed field');
		}

		ctx.request.body = ctx.request.body || {};
		ctx.request.body.data = {
			requested_changes: filteredChanges,
			users_permissions_user: user.id,
			company: userData.company,
			request_status: 'Pending',
		};

		return await super.create(ctx);
	},

	async update(ctx) {
		// Users should not update request records directly after creation.
		return ctx.forbidden('Profile edit request updates are not allowed from this endpoint');
	},
}));
