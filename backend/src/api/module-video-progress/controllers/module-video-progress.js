'use strict';

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::module-video-progress.module-video-progress",
  ({ strapi }) => ({
    async markAsRead(ctx) {
      const {
        userId,
        courseId: courseIdParam,
        course: courseParam,
        moduleIndex,
        moduleTitle,
        videoDurationMin,
        timeWatchedMin,
      } = ctx.request.body || {};

      // Accept either `courseId` or `course` from the request body
      const courseId = Number(courseIdParam ?? courseParam);

      if (userId == null || !courseId || moduleIndex === undefined) {
        return ctx.badRequest("Missing required fields: userId, courseId, moduleIndex");
      }

      const uid = "api::module-video-progress.module-video-progress";
      const filters = {
        user: { id: Number(userId) },
        course: { id: courseId },
        module_index: Number(moduleIndex),
      };

      // Primary lookup: exact user + course + module_index
      let existing = await strapi.entityService.findMany(uid, {
        filters,
        limit: 1,
      }).then((list) => list[0] || null);

      // Self-heal fallback: if no record found by index (can happen when old records
      // were saved with the language-filtered index instead of the global index),
      // find by module_title so we UPDATE the old wrong record instead of creating
      // a duplicate alongside it.
      if (!existing && moduleTitle && String(moduleTitle).trim()) {
        const byTitle = await strapi.entityService.findMany(uid, {
          filters: {
            user: { id: Number(userId) },
            course: { id: courseId },
            module_title: String(moduleTitle).trim(),
          },
          limit: 1,
        }).then((list) => list[0] || null);
        if (byTitle) existing = byTitle;
      }

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