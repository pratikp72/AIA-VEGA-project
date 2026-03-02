'use strict';

const { Readable } = require('stream');

/**
 * Captures raw request body for certain API routes before the body parser.
 * Fixes empty ctx.request.body when requests come from the frontend (browser).
 * Stores parsed body in ctx.state and replaces the consumed stream so the body
 * parser can still read it (avoids "stream is not readable" error).
 */
module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    const path = (ctx.path || ctx.request?.path || '').toLowerCase();
    const isFeedbackSubmit =
      path.includes('feedback-submission') && path.endsWith('/submit');
    const isQuizReattempt =
      path.includes('quiz-reattempt-request');

    const shouldCapture = ctx.method === 'POST' && (isFeedbackSubmit || isQuizReattempt);

    if (shouldCapture) {
      try {
        const chunks = [];
        await new Promise((resolve, reject) => {
          ctx.req.on('data', (chunk) => chunks.push(chunk));
          ctx.req.on('end', resolve);
          ctx.req.on('error', reject);
        });
        const buffer = Buffer.concat(chunks);
        const raw = buffer.toString('utf8');
        if (raw && raw.trim()) {
          const parsed = JSON.parse(raw);
          if (isFeedbackSubmit) ctx.state.feedbackBody = parsed;
          if (isQuizReattempt) ctx.state.quizReattemptBody = parsed;
        }
        // Replace consumed stream with a new readable so body parser can read it
        const newStream = Readable.from([buffer]);
        const orig = ctx.req;
        newStream.headers = orig.headers;
        newStream.method = orig.method;
        newStream.url = orig.url;
        ctx.req = newStream;
      } catch (err) {
        strapi.log.warn('capture-feedback-body: parse failed', err);
      }
    }

    await next();
  };
};
