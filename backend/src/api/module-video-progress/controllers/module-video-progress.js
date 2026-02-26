'use strict';

/**
 * module-video-progress controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::module-video-progress.module-video-progress",
  ({ strapi }) => ({

    async markAsRead(ctx) {
      const { userId, courseId, moduleIndex, moduleTitle, videoDurationMin, timeWatchedMin } = ctx.request.body;

      if (!userId || !courseId || moduleIndex === undefined)
        return ctx.badRequest("Missing required fields");

      // Check if exists
      const existing = await strapi.db
        .query("api::module-video-progress.module-video-progress")
        .findOne({
          where: { user: userId, course: courseId, module_index: moduleIndex },
        });

      const payload = {
        user: userId,
        course: courseId,
        module_index: moduleIndex,
        module_title: moduleTitle || null,
        video_completion_type: "full_watch",
        video_duration_min: videoDurationMin,
        time_watched_min: timeWatchedMin,
        last_updated: new Date(),
      };

      let entry;

      if (existing) {
        entry = await strapi.db
          .query("api::module-video-progress.module-video-progress")
          .update({
            where: { id: existing.id },
            data: payload,
          });
      } else {
        entry = await strapi.db
          .query("api::module-video-progress.module-video-progress")
          .create({
            data: payload,
          });
      }

      return ctx.send({
        message: "Module marked as completed",
        progress: entry,
      });
    },
  })
);