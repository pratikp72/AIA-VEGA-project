'use strict';

const VALID_EVENT_NAMES = new Set([
  'page_view_started',
  'page_view_ended',
  'page_click',
  'heartbeat',
  'learning_module_enter',
  'learning_module_exit',
  'learning_video_progress',
  'learning_video_completed',
  'learning_quiz_started',
  'learning_quiz_submitted',
  'learning_feedback_opened',
  'learning_feedback_submitted',
]);

const LEARNING_TIME_EVENTS = new Set([
  'learning_module_exit',
  'learning_video_progress',
  'learning_video_completed',
  'learning_quiz_submitted',
  'learning_feedback_submitted',
]);

function normalizeDateBound(value, endOfDay) {
  if (value == null || value === '') return null;
  const str = typeof value === 'string' ? value.trim() : (value instanceof Date ? value.toISOString() : String(value));
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return endOfDay ? `${str}T23:59:59.999Z` : `${str}T00:00:00.000Z`;
  }
  return str;
}

function safeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function clampNonNegative(value) {
  return Math.max(0, safeInt(value, 0));
}

function toIso(value, fallbackNow = false) {
  if (value == null || value === '') return fallbackNow ? new Date().toISOString() : null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallbackNow ? new Date().toISOString() : null;
  return d.toISOString();
}

function getUserIdFromRecord(row) {
  return row.user?.id ?? row.user_id ?? (typeof row.user === 'number' ? row.user : null);
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

module.exports = ({ strapi }) => {
  const self = {
    cache: {
      lastRefreshedAt: null,
      pageSummary: null,
      learningSummary: null,
    },
  };

  self.resolveUserCompany = async function resolveUserCompany(user) {
    const rawCompany = (user?.company || '').trim();
    if (!rawCompany) return { companyName: null, companyId: null };
    const normalizedName = rawCompany.toUpperCase() === 'VEGA' ? 'Vega' : (rawCompany.toUpperCase() === 'AIA' ? 'AIA' : rawCompany);
    let companyId = null;
    try {
      const row = await strapi.db.query('api::company.company').findOne({
        where: { name: { $eqi: normalizedName } },
        select: ['id', 'name'],
      });
      if (row?.id != null) companyId = row.id;
    } catch (e) {
      strapi.log.warn('analyticsTelemetry.resolveUserCompany: failed to resolve company id', e?.message || e);
    }
    return { companyName: normalizedName, companyId };
  };

  self._validateIncomingEvent = function _validateIncomingEvent(event, index) {
    const errors = [];
    const eventId = typeof event?.event_id === 'string' ? event.event_id.trim() : '';
    const eventName = typeof event?.event_name === 'string' ? event.event_name.trim() : '';
    const occurredAt = toIso(event?.occurred_at, false);

    if (!eventId) errors.push('event_id is required');
    if (!eventName) errors.push('event_name is required');
    if (eventName && !VALID_EVENT_NAMES.has(eventName)) {
      errors.push('event_name is not supported');
    }
    if (!occurredAt) errors.push('occurred_at must be a valid datetime');

    const durationSeconds = clampNonNegative(event?.duration_seconds);
    const clickCount = clampNonNegative(event?.click_count);

    // For route-level metrics, route_path should be present on portal events.
    const needsRoute = eventName.startsWith('page_') || eventName === 'heartbeat';
    const routePath = typeof event?.route_path === 'string' ? event.route_path.trim() : '';
    if (needsRoute && !routePath) errors.push('route_path is required for page events');

    const metadata = event?.metadata_json ?? event?.metadata ?? null;
    if (metadata != null && typeof metadata !== 'object') {
      errors.push('metadata_json must be an object when provided');
    }

    return {
      index,
      ok: errors.length === 0,
      errors,
      normalized: {
        event_id: eventId,
        event_name: eventName,
        occurred_at: occurredAt,
        session_id: typeof event?.session_id === 'string' ? event.session_id.trim() : null,
        route_path: routePath || null,
        page_type: typeof event?.page_type === 'string' ? event.page_type.trim() : null,
        entity_type: typeof event?.entity_type === 'string' ? event.entity_type.trim() : null,
        entity_id: event?.entity_id != null ? String(event.entity_id).trim() : null,
        duration_seconds: durationSeconds,
        click_count: clickCount,
        metadata: metadata && typeof metadata === 'object' ? metadata : null,
        client_ts: toIso(event?.client_ts, false),
        tz_offset: event?.tz_offset != null ? safeInt(event.tz_offset, 0) : null,
        source: typeof event?.source === 'string' && event.source.trim() ? event.source.trim() : 'web',
      },
    };
  };

  self.ingestEvents = async function ingestEvents({ user, body }) {
    if (!user?.id) throw new Error('Authentication required');

    const payloadEvents = Array.isArray(body?.events)
      ? body.events
      : (body && typeof body === 'object' ? [body] : []);

    if (payloadEvents.length === 0) {
      return {
        success: false,
        ingested: 0,
        duplicates: 0,
        rejected: 0,
        errors: [{ index: -1, message: 'No events provided' }],
      };
    }

    const capped = payloadEvents.slice(0, 100);
    const { companyId } = await self.resolveUserCompany(user);

    let ingested = 0;
    let duplicates = 0;
    let rejected = 0;
    const errors = [];

    for (let i = 0; i < capped.length; i += 1) {
      const result = self._validateIncomingEvent(capped[i], i);
      if (!result.ok) {
        rejected += 1;
        errors.push({ index: i, message: result.errors.join('; ') });
        continue;
      }

      const e = result.normalized;
      try {
        const existing = await strapi.db.query('api::analytics-event.analytics-event').findOne({
          where: { event_id: e.event_id },
          select: ['id'],
        });
        if (existing?.id != null) {
          duplicates += 1;
          continue;
        }

        await strapi.documents('api::analytics-event.analytics-event').create({
          data: {
            event_id: e.event_id,
            event_name: e.event_name,
            occurred_at: e.occurred_at,
            ingested_at: new Date().toISOString(),
            session_id: e.session_id,
            route_path: e.route_path,
            page_type: e.page_type,
            entity_type: e.entity_type,
            entity_id: e.entity_id,
            duration_seconds: e.duration_seconds,
            click_count: e.click_count,
            metadata: e.metadata,
            client_ts: e.client_ts,
            tz_offset: e.tz_offset,
            source: e.source,
            user: user.id,
            company: companyId || undefined,
          },
        });

        ingested += 1;
      } catch (err) {
        rejected += 1;
        errors.push({ index: i, message: err?.message || 'Failed to persist event' });
      }
    }

    return {
      success: rejected === 0,
      ingested,
      duplicates,
      rejected,
      errors,
      cappedAt: payloadEvents.length > 100 ? 100 : null,
    };
  };

  self._buildEventsWhere = async function _buildEventsWhere(params = {}) {
    const where = {};

    const from = normalizeDateBound(params.dateFrom, false);
    const to = normalizeDateBound(params.dateTo, true);
    if (from || to) {
      where.occurred_at = {};
      if (from) where.occurred_at.$gte = from;
      if (to) where.occurred_at.$lte = to;
    }

    if (params.routePath) where.route_path = { $eq: String(params.routePath).trim() };
    if (params.pageType) where.page_type = { $eq: String(params.pageType).trim() };
    if (params.entityType) where.entity_type = { $eq: String(params.entityType).trim() };
    if (params.entityId != null && params.entityId !== '') where.entity_id = { $eq: String(params.entityId).trim() };
    if (params.eventName) where.event_name = { $eq: String(params.eventName).trim() };

    if (params.userId != null && params.userId !== '') {
      const n = safeInt(params.userId, NaN);
      if (!Number.isNaN(n)) {
        where.user = { id: n };
      }
    }

    const hasCompanyFilter = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const hasDeptFilter = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    const hasLocationFilter = params.location && String(params.location).trim();

    if (hasCompanyFilter || hasDeptFilter || hasLocationFilter) {
      const userWhere = { blocked: { $ne: true } };
      if (hasCompanyFilter) {
        const c = String(params.company).trim().toLowerCase();
        userWhere.company = c === 'vega' ? 'Vega' : (c === 'aia' ? 'AIA' : String(params.company).trim());
      }
      if (hasDeptFilter) {
        userWhere.department = { $containsi: String(params.department).trim() };
      }
      if (hasLocationFilter) {
        userWhere.working_location = { $containsi: String(params.location).trim() };
      }

      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: userWhere,
        select: ['id'],
      });
      const ids = (users || []).map((u) => u.id).filter((id) => id != null);
      if (ids.length === 0) return null;
      where.user = { id: { $in: ids } };
    }

    return where;
  };

  self.getRoutePageStats = async function getRoutePageStats(params = {}) {
    const where = await self._buildEventsWhere(params);
    if (where === null) return { rows: [], total: 0 };

    const events = await strapi.db.query('api::analytics-event.analytics-event').findMany({
      where,
      limit: 100000,
      select: ['event_name', 'route_path', 'page_type', 'duration_seconds', 'click_count', 'occurred_at'],
      populate: { user: { select: ['id'] } },
    });

    const byRoute = new Map();
    for (const row of events || []) {
      const route = row.route_path || '__unknown';
      const pageType = row.page_type || 'Unknown';
      const key = `${route}::${pageType}`;
      if (!byRoute.has(key)) {
        byRoute.set(key, {
          route_path: route,
          page_type: pageType,
          visits: 0,
          unique_users: new Set(),
          total_time_seconds: 0,
          total_clicks: 0,
        });
      }
      const item = byRoute.get(key);
      const uid = getUserIdFromRecord(row);
      if (uid != null) item.unique_users.add(uid);
      if (row.event_name === 'page_view_started') item.visits += 1;
      if (row.event_name === 'page_click') item.total_clicks += 1;
      item.total_clicks += clampNonNegative(row.click_count);
      item.total_time_seconds += clampNonNegative(row.duration_seconds);
    }

    const rows = Array.from(byRoute.values())
      .map((v) => ({
        route_path: v.route_path,
        page_type: v.page_type,
        visits: v.visits,
        unique_users: v.unique_users.size,
        total_time_seconds: v.total_time_seconds,
        total_time_minutes: round1(v.total_time_seconds / 60),
        total_clicks: v.total_clicks,
      }))
      .sort((a, b) => b.total_time_seconds - a.total_time_seconds);

    return { rows, total: rows.length };
  };

  self.getRouteTrend = async function getRouteTrend(params = {}) {
    const where = await self._buildEventsWhere(params);
    if (where === null) return [];

    const events = await strapi.db.query('api::analytics-event.analytics-event').findMany({
      where,
      limit: 100000,
      select: ['event_name', 'duration_seconds', 'click_count', 'occurred_at'],
      populate: { user: { select: ['id'] } },
    });

    const buckets = new Map();
    const push = (bucketKey, row) => {
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          bucket_start: bucketKey,
          visits: 0,
          total_time_seconds: 0,
          total_clicks: 0,
          unique_users: new Set(),
        });
      }
      const b = buckets.get(bucketKey);
      const uid = getUserIdFromRecord(row);
      if (uid != null) b.unique_users.add(uid);
      if (row.event_name === 'page_view_started') b.visits += 1;
      if (row.event_name === 'page_click') b.total_clicks += 1;
      b.total_clicks += clampNonNegative(row.click_count);
      b.total_time_seconds += clampNonNegative(row.duration_seconds);
    };

    for (const row of events || []) {
      if (!row.occurred_at) continue;
      const d = new Date(row.occurred_at);
      if (Number.isNaN(d.getTime())) continue;
      d.setUTCSeconds(0, 0);
      const minute = d.getUTCMinutes();
      d.setUTCMinutes(minute - (minute % 5));
      push(d.toISOString(), row);
    }

    return Array.from(buckets.values())
      .map((b) => ({
        bucket_start: b.bucket_start,
        visits: b.visits,
        unique_users: b.unique_users.size,
        total_clicks: b.total_clicks,
        total_time_seconds: b.total_time_seconds,
        total_time_minutes: round1(b.total_time_seconds / 60),
      }))
      .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
  };

  self.getLearningStats = async function getLearningStats(params = {}) {
    const where = await self._buildEventsWhere(params);
    if (where === null) {
      return {
        totals: {
          module_time_seconds: 0,
          video_time_seconds: 0,
          quiz_time_seconds: 0,
          feedback_time_seconds: 0,
          unique_users: 0,
          dropoff_count: 0,
        },
        by_entity: [],
      };
    }

    where.event_name = { $in: Array.from(VALID_EVENT_NAMES).filter((n) => n.startsWith('learning_')) };

    const events = await strapi.db.query('api::analytics-event.analytics-event').findMany({
      where,
      limit: 100000,
      select: ['event_name', 'entity_type', 'entity_id', 'duration_seconds'],
      populate: { user: { select: ['id'] } },
    });

    const uniqueUsers = new Set();
    const byEntity = new Map();
    const moduleEnters = new Set();
    const moduleExits = new Set();

    let moduleTime = 0;
    let videoTime = 0;
    let quizTime = 0;
    let feedbackTime = 0;

    for (const row of events || []) {
      const uid = getUserIdFromRecord(row);
      const et = row.entity_type || 'unknown';
      const eid = row.entity_id || 'unknown';
      const key = `${et}::${eid}`;
      const duration = clampNonNegative(row.duration_seconds);
      const eventName = row.event_name || '';

      if (!byEntity.has(key)) {
        byEntity.set(key, {
          entity_type: et,
          entity_id: eid,
          total_time_seconds: 0,
          unique_users: new Set(),
          events: 0,
        });
      }

      const bucket = byEntity.get(key);
      bucket.events += 1;
      bucket.total_time_seconds += duration;

      if (uid != null) {
        uniqueUsers.add(uid);
        bucket.unique_users.add(uid);
      }

      if (eventName === 'learning_module_enter' && uid != null) moduleEnters.add(`${uid}::${key}`);
      if ((eventName === 'learning_module_exit' || eventName === 'learning_video_completed') && uid != null) moduleExits.add(`${uid}::${key}`);

      if (!LEARNING_TIME_EVENTS.has(eventName)) continue;
      if (eventName.includes('module')) moduleTime += duration;
      else if (eventName.includes('video')) videoTime += duration;
      else if (eventName.includes('quiz')) quizTime += duration;
      else if (eventName.includes('feedback')) feedbackTime += duration;
    }

    let dropoffCount = 0;
    for (const key of moduleEnters) {
      if (!moduleExits.has(key)) dropoffCount += 1;
    }

    return {
      totals: {
        module_time_seconds: moduleTime,
        video_time_seconds: videoTime,
        quiz_time_seconds: quizTime,
        feedback_time_seconds: feedbackTime,
        unique_users: uniqueUsers.size,
        dropoff_count: dropoffCount,
      },
      by_entity: Array.from(byEntity.values())
        .map((v) => ({
          entity_type: v.entity_type,
          entity_id: v.entity_id,
          total_time_seconds: v.total_time_seconds,
          total_time_minutes: round1(v.total_time_seconds / 60),
          unique_users: v.unique_users.size,
          events: v.events,
        }))
        .sort((a, b) => b.total_time_seconds - a.total_time_seconds),
    };
  };

  self.refreshAggregateCaches = async function refreshAggregateCaches() {
    const now = new Date().toISOString();
    const defaultRange = {
      dateFrom: new Date(Date.now() - (1000 * 60 * 60 * 24 * 30)).toISOString(),
      dateTo: now,
    };

    try {
      const [pageSummary, learningSummary] = await Promise.all([
        self.getRoutePageStats(defaultRange),
        self.getLearningStats(defaultRange),
      ]);
      self.cache.lastRefreshedAt = now;
      self.cache.pageSummary = pageSummary;
      self.cache.learningSummary = learningSummary;
      return { ok: true, lastRefreshedAt: now };
    } catch (e) {
      strapi.log.error('analyticsTelemetry.refreshAggregateCaches error:', e?.message || e);
      return { ok: false, lastRefreshedAt: self.cache.lastRefreshedAt };
    }
  };

  self.getCacheStatus = function getCacheStatus() {
    return {
      lastRefreshedAt: self.cache.lastRefreshedAt,
      hasPageSummary: !!self.cache.pageSummary,
      hasLearningSummary: !!self.cache.learningSummary,
    };
  };

  return self;
};
