/**
 * Marks Content Manager saves that come from a duplicated course flow so the API can strip
 * course_assignments on create/update (second Save often sends relations only on PUT).
 */

//@ts-nocheck

export const VEGA_DUP_COURSE_ASSIGN_STORAGE = 'vega_dup_course_strip_assignments';

export function markDuplicateCourseFlowActive() {
  try {
    sessionStorage.setItem(VEGA_DUP_COURSE_ASSIGN_STORAGE, '1');
  } catch (e) {
    /* ignore */
  }
}

export function clearDuplicateCourseFlow() {
  try {
    sessionStorage.removeItem(VEGA_DUP_COURSE_ASSIGN_STORAGE);
  } catch (e) {
    /* ignore */
  }
}

function isDuplicateCourseFlowActive() {
  try {
    return sessionStorage.getItem(VEGA_DUP_COURSE_ASSIGN_STORAGE) === '1';
  } catch (e) {
    return false;
  }
}

function isCourseContentManagerUrl(url) {
  return (
    url.includes('/content-manager/') &&
    /collection-types\/api::course\.course/i.test(url)
  );
}

export function installVegaDuplicateCourseFetchInterceptor() {
  if (typeof window === 'undefined' || window.__vegaDupCourseFetchInstalled) return;
  window.__vegaDupCourseFetchInstalled = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async function vegaDupCourseFetch(input, init = {}) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : input?.url || '';
    } catch (e) {
      url = '';
    }

    const method = String(
      init?.method ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.method : '') ||
        (typeof input !== 'string' && input?.method) ||
        'GET'
    ).toUpperCase();

    const shouldTag =
      isDuplicateCourseFlowActive() && isCourseContentManagerUrl(url) && method !== 'GET';

    let requestInput = input;
    let nextInit = init;

    if (shouldTag) {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        const headers = new Headers(input.headers);
        if (!headers.has('X-Vega-Duplicate-Course')) {
          headers.set('X-Vega-Duplicate-Course', '1');
        }
        requestInput = new Request(input, { headers });
        nextInit = undefined;
      } else {
        const headers = new Headers(init.headers || undefined);
        if (!headers.has('X-Vega-Duplicate-Course')) {
          headers.set('X-Vega-Duplicate-Course', '1');
        }
        nextInit = { ...init, headers };
      }
    }

    const res = await origFetch(requestInput, nextInit);

    try {
      if (shouldTag && res.ok && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        // Strapi often issues a follow-up save; keep tagging briefly so the next request still strips.
        setTimeout(() => clearDuplicateCourseFlow(), 8000);
      }
    } catch (e) {
      /* ignore */
    }

    return res;
  };
}

const COURSE_ASSIGNMENT_LIST_PATH_RE = /\/content-manager\/collection-types\/api::course-assignment\.course-assignment(?:\/|$)/i;

function decodeSafe(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (e) {
    return String(value || '');
  }
}

function isCourseAssignmentCollectionUrl(url) {
  const raw = String(url || '');
  const decoded = decodeSafe(raw);
  return (
    COURSE_ASSIGNMENT_LIST_PATH_RE.test(raw) ||
    COURSE_ASSIGNMENT_LIST_PATH_RE.test(decoded) ||
    raw.includes('/content-manager/collection-types/api%3A%3Acourse-assignment.course-assignment') ||
    decoded.includes('/content-manager/collection-types/api::course-assignment.course-assignment')
  );
}

function getCourseAssignmentCourseLabel(value) {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value.map(getCourseAssignmentCourseLabel).filter(Boolean).join(', ') || '—';
  }
  return value.title || value.name || value.documentId || String(value.id ?? '—');
}

function setCellTextWithRowStyle(cells, targetCell, text, targetIndex) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return;

  let template = null;
  for (let i = 0; i < cells.length; i++) {
    if (i === targetIndex) continue;
    const candidate = cells[i]?.querySelector('span, p, div');
    if (!candidate) continue;
    const candidateText = String(candidate.textContent || '').trim();
    if (!candidateText) continue;
    template = candidate;
    break;
  }

  if (template) {
    const clone = template.cloneNode(false);
    clone.textContent = normalizedText;
    clone.style.whiteSpace = 'normal';
    clone.style.display = 'inline-block';
    clone.style.maxWidth = '120px';
    clone.style.wordBreak = 'break-word';
    clone.style.overflowWrap = 'anywhere';
    targetCell.replaceChildren(clone);
    return;
  }

  targetCell.textContent = normalizedText;
}

function patchCourseAssignmentCoursesTable() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!COURSE_ASSIGNMENT_LIST_PATH_RE.test(window.location.pathname)) return;

  const rowsById = window.__vegaCourseAssignmentRowsById;
  if (!rowsById || typeof rowsById !== 'object') return;

  const tables = Array.from(document.querySelectorAll('table'));
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll('thead th'));
    const idIndex = headers.findIndex((header) => String(header.textContent || '').trim().toLowerCase() === 'id');
    const coursesIndex = headers.findIndex((header) => String(header.textContent || '').trim().toLowerCase() === 'courses');
    if (idIndex === -1 || coursesIndex === -1) continue;

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    if (bodyRows.length === 0) continue;

    bodyRows.forEach((tr) => {
      const cells = Array.from(tr.children);
      const idCell = cells[idIndex];
      const cell = cells[coursesIndex];
      if (!idCell || !cell) return;

      const rowIdText = String(idCell.textContent || '').replace(/,/g, '').trim();
      const rowId = Number(rowIdText);
      if (!Number.isFinite(rowId)) return;

      const row = rowsById[rowId];
      if (!row) return;

      const courseLabel = getCourseAssignmentCourseLabel(row.courses);
      const current = String(cell.textContent || '').trim();
      if (courseLabel && current !== courseLabel) {
        setCellTextWithRowStyle(cells, cell, courseLabel, coursesIndex);
      }
    });
  }
}

const CA_ACTIVE_FILTER_CLEARED_KEY = 'vega.courseAssignment.activeFilterCleared';
const DEFAULT_ACTIVE_FILTER_VALUE = 'published';
const LIST_VIEW_SETTINGS_PREFIX = 'STRAPI_LIST_VIEW_SETTINGS:';

let lastCourseAssignmentListHadActiveFilter = false;
/** After opening the collection from outside, force Active=published until Strapi finishes restoring. */
let forceDefaultActiveResetUntil = 0;

function isCourseAssignmentCollectionPath(pathname) {
  const path = decodeSafe(pathname || '');
  return /\/content-manager\/collection-types\/api::course-assignment\.course-assignment(?:\/|$)/i.test(path);
}

function isCourseAssignmentListPagePath(pathname) {
  const path = decodeSafe(pathname || '');
  return /\/content-manager\/collection-types\/api::course-assignment\.course-assignment\/?$/i.test(path);
}

function isCourseAssignmentListGetUrl(url) {
  try {
    const parsed = new URL(String(url || ''), window.location.origin);
    return isCourseAssignmentListPagePath(parsed.pathname);
  } catch (e) {
    const decoded = decodeSafe(url);
    return (
      /\/content-manager\/collection-types\/api::course-assignment\.course-assignment(?:\?|$)/i.test(decoded) ||
      /\/content-manager\/collection-types\/api%3A%3Acourse-assignment\.course-assignment(?:\?|$)/i.test(String(url || ''))
    );
  }
}

function urlHasActiveFieldFilter(url) {
  const decoded = decodeSafe(url);
  return /filters(?:\[\$and\]\[\d+\]|\[\$or\]\[\d+\])?\[active\]/i.test(decoded);
}

function isForceDefaultActiveResetActive() {
  return Date.now() < forceDefaultActiveResetUntil;
}

/** Drop every filters[...] param; keep page/pageSize/sort. */
function stripFilterSearchParams(searchParams) {
  const keysToDelete = [];
  searchParams.forEach((_, key) => {
    if (String(key).startsWith('filters')) keysToDelete.push(key);
  });
  keysToDelete.forEach((key) => searchParams.delete(key));
}

function rebuildUrlWithActivePublishedOnly(url) {
  const parsed = new URL(String(url || ''), window.location.origin);
  stripFilterSearchParams(parsed.searchParams);
  parsed.searchParams.set(`filters[$and][0][active][$eq]`, DEFAULT_ACTIVE_FILTER_VALUE);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function appendDefaultActiveFilterToUrl(url) {
  const parsed = new URL(String(url || ''), window.location.origin);
  let maxAndIndex = -1;
  parsed.searchParams.forEach((_, key) => {
    const match = String(key).match(/^filters\[\$and\]\[(\d+)\]/);
    if (match) maxAndIndex = Math.max(maxAndIndex, Number(match[1]));
  });
  const nextIndex = maxAndIndex + 1;
  parsed.searchParams.set(`filters[$and][${nextIndex}][active][$eq]`, DEFAULT_ACTIVE_FILTER_VALUE);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Strapi ListView persists filters in localStorage (STRAPI_LIST_VIEW_SETTINGS:+pathname).
 * That is why reopening the collection restores the last course-name filter.
 * Overwrite with Active=published on a fresh open of the collection.
 */
function resetPersistedCourseAssignmentListFilters() {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const defaultFilters = { $and: [{ active: { $eq: DEFAULT_ACTIVE_FILTER_VALUE } }] };
  const keys = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (
      key &&
      key.startsWith(LIST_VIEW_SETTINGS_PREFIX) &&
      /course-assignment\.course-assignment/i.test(key)
    ) {
      keys.push(key);
    }
  }

  // Also cover the current pathname variant even if nothing was stored yet.
  const path = decodeSafe(window.location.pathname || '');
  const listPathMatch = path.match(/(\/content-manager\/collection-types\/api::course-assignment\.course-assignment)\/?$/i);
  if (listPathMatch) {
    const candidate = `${LIST_VIEW_SETTINGS_PREFIX}${listPathMatch[1]}`;
    if (!keys.includes(candidate)) keys.push(candidate);
  }

  keys.forEach((key) => {
    let existing = {};
    try {
      existing = JSON.parse(window.localStorage.getItem(key) || '{}') || {};
    } catch (e) {
      existing = {};
    }
    const next = {
      ...existing,
      filters: defaultFilters,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch (e) {
      /* ignore */
    }
  });
}

function syncForcedActiveFilterToBrowserUrl() {
  if (!isCourseAssignmentListPagePath(window.location.pathname)) return;
  const next = rebuildUrlWithActivePublishedOnly(window.location.href);
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', next);
  }
}

/**
 * Fresh open of Course Assignments (from sidebar / another CT) — ignore sticky filters.
 */
function onEnterCourseAssignmentListFresh() {
  try {
    sessionStorage.removeItem(CA_ACTIVE_FILTER_CLEARED_KEY);
  } catch (e) {
    /* ignore */
  }
  lastCourseAssignmentListHadActiveFilter = false;
  forceDefaultActiveResetUntil = Date.now() + 1500;
  resetPersistedCourseAssignmentListFilters();
  try {
    syncForcedActiveFilterToBrowserUrl();
  } catch (e) {
    /* ignore */
  }
}

function onLeaveCourseAssignmentCollection() {
  try {
    sessionStorage.removeItem(CA_ACTIVE_FILTER_CLEARED_KEY);
  } catch (e) {
    /* ignore */
  }
  lastCourseAssignmentListHadActiveFilter = false;
  forceDefaultActiveResetUntil = 0;
}

/**
 * Default list filter Active=published, but allow clearing during the visit.
 * On a fresh collection open, replace sticky filters (e.g. course name) with Active only.
 */
function applyClearableDefaultActiveFilter(url) {
  if (isForceDefaultActiveResetActive()) {
    lastCourseAssignmentListHadActiveFilter = true;
    return rebuildUrlWithActivePublishedOnly(url);
  }

  const hasActive = urlHasActiveFieldFilter(url);

  if (!hasActive && lastCourseAssignmentListHadActiveFilter) {
    try {
      sessionStorage.setItem(CA_ACTIVE_FILTER_CLEARED_KEY, '1');
    } catch (e) {
      /* ignore */
    }
  }

  if (hasActive) {
    try {
      sessionStorage.removeItem(CA_ACTIVE_FILTER_CLEARED_KEY);
    } catch (e) {
      /* ignore */
    }
    lastCourseAssignmentListHadActiveFilter = true;
    return url;
  }

  let cleared = false;
  try {
    cleared = sessionStorage.getItem(CA_ACTIVE_FILTER_CLEARED_KEY) === '1';
  } catch (e) {
    cleared = false;
  }

  if (cleared) {
    lastCourseAssignmentListHadActiveFilter = false;
    return url;
  }

  lastCourseAssignmentListHadActiveFilter = true;
  return appendDefaultActiveFilterToUrl(url);
}

function syncDefaultActiveFilterToBrowserUrl() {
  if (!isCourseAssignmentListPagePath(window.location.pathname)) return;

  if (isForceDefaultActiveResetActive()) {
    syncForcedActiveFilterToBrowserUrl();
    return;
  }

  if (urlHasActiveFieldFilter(window.location.href)) return;
  try {
    if (sessionStorage.getItem(CA_ACTIVE_FILTER_CLEARED_KEY) === '1') return;
  } catch (e) {
    /* ignore */
  }
  const next = appendDefaultActiveFilterToUrl(window.location.href);
  window.history.replaceState(window.history.state, '', next);
}

function handleCourseAssignmentPathChange(prevPathname, nextPathname) {
  const wasList = isCourseAssignmentListPagePath(prevPathname);
  const isList = isCourseAssignmentListPagePath(nextPathname);
  const wasCollection = isCourseAssignmentCollectionPath(prevPathname);
  const isCollection = isCourseAssignmentCollectionPath(nextPathname);

  // Opened list from outside this collection (sidebar / another content-type)
  if (!wasList && isList && !wasCollection) {
    onEnterCourseAssignmentListFresh();
    return;
  }

  // Left the collection entirely
  if (wasCollection && !isCollection) {
    onLeaveCourseAssignmentCollection();
  }
}

function installCourseAssignmentListRouteWatcher() {
  if (typeof window === 'undefined' || window.__vegaCourseAssignmentListRouteWatcherInstalled) return;
  window.__vegaCourseAssignmentListRouteWatcherInstalled = true;

  window.addEventListener('popstate', () => {
    // Best-effort: treat browser back/forward onto the list as a fresh open
    if (isCourseAssignmentListPagePath(window.location.pathname)) {
      onEnterCourseAssignmentListFresh();
    } else if (!isCourseAssignmentCollectionPath(window.location.pathname)) {
      onLeaveCourseAssignmentCollection();
    }
  });

  const origPushState = window.history.pushState.bind(window.history);
  const origReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = function vegaPushState(state, title, url) {
    const prevPathname = window.location.pathname;
    const result = origPushState(state, title, url);
    handleCourseAssignmentPathChange(prevPathname, window.location.pathname);
    return result;
  };

  window.history.replaceState = function vegaReplaceState(state, title, url) {
    const prevPathname = window.location.pathname;
    const result = origReplaceState(state, title, url);
    handleCourseAssignmentPathChange(prevPathname, window.location.pathname);
    return result;
  };

  // Admin loaded directly on the list page
  if (isCourseAssignmentListPagePath(window.location.pathname)) {
    onEnterCourseAssignmentListFresh();
  }
}

export function installCourseAssignmentCoursesTablePatch() {
  if (typeof window === 'undefined' || window.__vegaCourseAssignmentCoursesTablePatchInstalled) return;
  window.__vegaCourseAssignmentCoursesTablePatchInstalled = true;

  const origFetch = window.fetch.bind(window);
  let scheduled = false;

  const schedulePatch = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      patchCourseAssignmentCoursesTable();
    });
  };

  window.fetch = async function courseAssignmentCoursesTableFetch(input, init = {}) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : input?.url || '';
    } catch (e) {
      url = '';
    }

    const method = String(
      init?.method ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : '') ||
      (typeof input !== 'string' && input?.method) ||
      'GET'
    ).toUpperCase();

    let requestInput = input;
    let nextInit = init;

    if (method === 'GET' && isCourseAssignmentListGetUrl(url)) {
      const rewritten = applyClearableDefaultActiveFilter(url);
      if (rewritten !== url) {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          requestInput = new Request(rewritten, input);
          nextInit = undefined;
        } else if (typeof input === 'string') {
          requestInput = rewritten;
        } else {
          requestInput = rewritten;
        }
        try {
          syncDefaultActiveFilterToBrowserUrl();
        } catch (e) {
          /* ignore */
        }
      }
      url = rewritten;
    }

    const res = await origFetch(requestInput, nextInit);

    try {
      if (method === 'GET' && isCourseAssignmentCollectionUrl(url) && res.ok) {
        const clone = res.clone();
        const json = await clone.json();
        const rows = Array.isArray(json?.results) ? json.results : Array.isArray(json?.data) ? json.data : [];
        if (rows.length > 0) {
          const byId = {};
          rows.forEach((row) => {
            const id = Number(row?.id);
            if (Number.isFinite(id)) byId[id] = row;
          });
          window.__vegaCourseAssignmentRowsById = byId;
          schedulePatch();
        }
      }
    } catch (e) {
      /* ignore */
    }

    return res;
  };

  const observer = new MutationObserver(() => {
    schedulePatch();
  });

  const startObserver = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      schedulePatch();
      return true;
    }
    return false;
  };

  if (!startObserver()) {
    const readyHandler = () => {
      if (startObserver()) {
        document.removeEventListener('DOMContentLoaded', readyHandler);
      }
    };
    document.addEventListener('DOMContentLoaded', readyHandler);
  }

  installCourseAssignmentListRouteWatcher();
}
