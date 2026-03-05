'use strict';

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::module-video-progress.module-video-progress",
  ({ strapi }) => ({
    async markAsRead(ctx) {
      const { userId, courseId, moduleIndex, moduleTitle, videoDurationMin, timeWatchedMin } = ctx.request.body || {};

      if (userId == null || courseId == null || moduleIndex === undefined) {
        return ctx.badRequest("Missing required fields: userId, courseId, moduleIndex");
      }

      const uid = "api::module-video-progress.module-video-progress";
      const filters = {
        user: { id: Number(userId) },
        course: { id: Number(courseId) },
        module_index: Number(moduleIndex),
      };

      const existing = await strapi.entityService.findMany(uid, {
        filters,
        limit: 1,
      }).then((list) => list[0] || null);

      const data = {
        user: Number(userId),
        course: Number(courseId),
        module_index: Number(moduleIndex),
        module_title: moduleTitle || null,
        video_completion_type: "full_watch",
        video_duration_min: Number(videoDurationMin) || 0,
        time_watched_min: Number(timeWatchedMin) || 0,
        last_updated: new Date(),
        publishedAt: new Date(),
      };

      let entry;
      if (existing) {
        entry = await strapi.entityService.update(uid, existing.id, { data });
      } else {
        entry = await strapi.entityService.create(uid, { data });
      }

      return ctx.send({
        message: "Module marked as completed",
        progress: entry,
      });
    },
  })
);