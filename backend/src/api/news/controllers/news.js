'use strict';

/**
 * news controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function ensurePublishDateNotPast(data) {
  const pub = data?.publish_date ?? data?.published_date ?? data?.publishedDate;
  if (!pub) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(pub);
  d.setHours(0, 0, 0, 0);
  if (d < today) {
    throw new Error('Please select current or future date.');
  }
}

module.exports = createCoreController('api::news.news', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishDateNotPast(body);
    return super.create(ctx);
  },
  async update(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishDateNotPast(body);
    return super.update(ctx);
  },

  /**
   * Like a news item (add current user to likes)
   * POST /api/news/:id/like
   */
  async like(ctx) {
    try {
      const user = ctx.state?.user;
      if (!user || !user.id) {
        return ctx.unauthorized('Authentication required');
      }

      const { id } = ctx.params;
      if (!id) {
        return ctx.badRequest('News ID is required');
      }

      // Get current news with likes
      const news = await strapi.documents('api::news.news').findOne({
        documentId: id,
        populate: ['likes'],
      });

      if (!news) {
        return ctx.notFound('News not found');
      }

      // Check if user already liked
      const alreadyLiked = news.likes?.some(u => u.id === user.id);
      if (alreadyLiked) {
        return ctx.body = { success: true, message: 'Already liked', likesCount: news.likes.length };
      }

      // Add user to likes
      const currentLikes = news.likes?.map(u => u.id) || [];
      await strapi.documents('api::news.news').update({
        documentId: id,
        data: {
          likes: [...currentLikes, user.id],
        },
      });
      // Notification: send to admin + HRadmin
      const meta = { newsId: id, userId: user.id };
      const notifUtil = strapi.utils?.notification;
      if (notifUtil) {
        await notifUtil.sendNotification(
          'news_liked',
          'News Liked',
          `User ${user.id} liked news item ${id}.`,
          [],
          meta,
          ['admin', 'HRadmin']
        );
      }

      ctx.body = { success: true, message: 'News liked', likesCount: currentLikes.length + 1 };
    } catch (error) {
      strapi.log.error('News like error:', error);
      ctx.body = { success: false, error: error?.message || 'Failed to like news' };
      ctx.status = 500;
    }
  },

  /**
   * Unlike a news item (remove current user from likes)
   * POST /api/news/:id/unlike
   */
  async unlike(ctx) {
    try {
      const user = ctx.state?.user;
      if (!user || !user.id) {
        return ctx.unauthorized('Authentication required');
      }

      const { id } = ctx.params;
      if (!id) {
        return ctx.badRequest('News ID is required');
      }

      // Get current news with likes
      const news = await strapi.documents('api::news.news').findOne({
        documentId: id,
        populate: ['likes'],
      });

      if (!news) {
        return ctx.notFound('News not found');
      }

      // Remove user from likes
      const currentLikes = news.likes?.map(u => u.id) || [];
      const updatedLikes = currentLikes.filter(userId => userId !== user.id);

      await strapi.documents('api::news.news').update({
        documentId: id,
        data: {
          likes: updatedLikes,
        },
      });

      ctx.body = { success: true, message: 'News unliked', likesCount: updatedLikes.length };
    } catch (error) {
      strapi.log.error('News unlike error:', error);
      ctx.body = { success: false, error: error?.message || 'Failed to unlike news' };
      ctx.status = 500;
    }
  },
}));
