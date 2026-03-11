'use strict';

/**
 * Learning Analytics – Quiz (global + personal).
 */
module.exports = ({ strapi }) => {
  async function getQuizGlobal(params = {}) {
    let submissions = [];
    try {
      submissions = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        status: 'published',
        populate: ['quiz', 'submitted_by'],
        limit: 5000,
        start: 0,
      });
      if (!Array.isArray(submissions)) submissions = [];
    } catch (e2) {
      strapi.log.warn('Quiz document findMany failed:', e2?.message || e2);
    }
    if (submissions.length === 0) {
      try {
        const where = {};
        if (params.userId) {
          const uid = params.userId;
          const numericId = typeof uid === 'number' ? uid : (typeof uid === 'string' && /^\d+$/.test(uid) ? parseInt(uid, 10) : null);
          if (numericId != null) where.submitted_by_id = numericId;
        }
        if (params.dateFrom || params.dateTo) {
          where.submitted_at = {};
          if (params.dateFrom) where.submitted_at.$gte = params.dateFrom;
          if (params.dateTo) where.submitted_at.$lte = params.dateTo;
        }
        const raw = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: Object.keys(where).length > 0 ? where : undefined,
          limit: 5000,
        });
        if (Array.isArray(raw) && raw.length > 0) submissions = raw;
      } catch (e) {
        strapi.log.warn('Quiz db.query failed:', e?.message);
      }
    }
    if (params.userId || params.dateFrom || params.dateTo) {
      const numericUserId = params.userId != null && (typeof params.userId === 'number' || /^\d+$/.test(String(params.userId)))
        ? Number(params.userId)
        : null;
      const isDocId = typeof params.userId === 'string' && params.userId.length > 10 && !/^\d+$/.test(params.userId);
      submissions = submissions.filter((s) => {
        if (params.userId != null) {
          const subBy = s.submitted_by ?? s;
          const matchId = numericUserId != null && (subBy.id === numericUserId || subBy.id === params.userId);
          const matchDocId = isDocId && (subBy.documentId === params.userId || subBy.document_id === params.userId);
          if (!matchId && !matchDocId) return false;
        }
        if (params.dateFrom && (s.submitted_at || s.submittedAt) < params.dateFrom) return false;
        if (params.dateTo && (s.submitted_at || s.submittedAt) > params.dateTo) return false;
        return true;
      });
    }
    const passed = submissions.filter((s) => s.passed).length;
    const total = submissions.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const avgScore = total > 0 ? Math.round(submissions.reduce((sum, s) => sum + (s.score || 0), 0) / total) : 0;
    return { passRate, avgScore, totalAttempts: total, passed, failed: total - passed };
  }

  return {
    getQuizGlobal,
    async getQuizPersonal(userId, params = {}) {
      return getQuizGlobal({ ...params, userId });
    },
  };
};
