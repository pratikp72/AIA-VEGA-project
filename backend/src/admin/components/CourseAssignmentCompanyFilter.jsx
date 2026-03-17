/**
 * CourseAssignmentCompanyFilter
 *
 * Injected into the Course Assignment edit view.
 * When `assignment_target_type` is "Company" and a company is selected:
 *   - Calls the dedicated /content-manager/courses-for-company endpoint
 *     (added via the content-manager extension) to get courses that belong
 *     to the selected company.
 *   - Uses a MutationObserver to hide picker rows whose title is NOT in the
 *     allowed set.
 * When target type is not "Company" (or no company selected) all markers are
 * removed and every course is visible again.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useForm, useFetchClient } from '@strapi/admin/strapi-admin';

const COURSE_ASSIGNMENT_MODEL = 'api::course-assignment.course-assignment';
const STYLE_ID  = 'ca-company-filter-style';
const DEBOUNCE_MS = 80;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pull a scalar company identifier from any shape Strapi v5 stores in the
 * form state: plain object, connect/set wrapper, array, or primitive.
 * Prefers documentId over numeric id.
 */
function extractCompanyId(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);

  // Common wrapper shape in Strapi relation inputs
  if (value && typeof value === 'object' && value.data) {
    const dataVal = value.data;
    if (Array.isArray(dataVal) && dataVal.length > 0) {
      const first = dataVal[0];
      const cid = first?.documentId ?? first?.id ?? first?.value?.documentId ?? first?.value?.id;
      return cid != null ? String(cid) : null;
    }
    if (dataVal && typeof dataVal === 'object') {
      const cid = dataVal.documentId ?? dataVal.id ?? dataVal.value?.documentId ?? dataVal.value?.id;
      return cid != null ? String(cid) : null;
    }
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (!first) return null;
    const cid = first?.documentId ?? first?.id ?? first?.value?.documentId ?? first?.value?.id;
    return cid != null ? String(cid) : null;
  }

  if (typeof value === 'object') {
    if (value.value && typeof value.value === 'object') {
      const cid = value.value.documentId ?? value.value.id;
      if (cid != null) return String(cid);
    }

    const pending = value.connect ?? value.set;
    if (Array.isArray(pending) && pending.length > 0) {
      const first = pending[0];
      const cid = first?.documentId ?? first?.id;
      return cid != null ? String(cid) : null;
    }
    const cid = value.documentId ?? value.id;
    return cid != null ? String(cid) : null;
  }
  return null;
}

function normalizeTargetType(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.value === 'string') return value.value;
    if (typeof value.label === 'string') return value.label;
  }
  return String(value);
}

function getCourseCompanyIds(course) {
  const out = [];

  const add = (v) => {
    if (v == null) return;
    out.push(String(v));
  };

  const pushFromObj = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    add(obj.documentId);
    add(obj.id);
    if (obj.value && typeof obj.value === 'object') {
      add(obj.value.documentId);
      add(obj.value.id);
    }
  };

  const rel = course?.company ?? course?.attributes?.company;
  if (Array.isArray(rel)) {
    rel.forEach(pushFromObj);
  } else if (rel && typeof rel === 'object') {
    if (Array.isArray(rel.data)) {
      rel.data.forEach(pushFromObj);
    } else if (rel.data && typeof rel.data === 'object') {
      pushFromObj(rel.data);
    }
    pushFromObj(rel);
  }

  return out;
}

function collectCourseKeys(course) {
  const out = new Set();
  const add = (v) => {
    if (v == null) return;
    const s = String(v).trim().toLowerCase();
    if (s) out.add(s);
  };

  add(course?.id);
  add(course?.documentId);
  add(course?.title);

  add(course?.attributes?.id);
  add(course?.attributes?.documentId);
  add(course?.attributes?.title);

  add(course?.value?.id);
  add(course?.value?.documentId);
  add(course?.value?.title);

  return out;
}

function courseAllowedByKeys(course, allowedKeys) {
  if (!(allowedKeys instanceof Set)) return true;
  const keys = collectCourseKeys(course);
  for (const k of keys) {
    if (allowedKeys.has(k)) return true;
  }
  return false;
}

// ─── Main wrapper ─────────────────────────────────────────────────────────────

export default function CourseAssignmentCompanyFilter({ slug, model }) {
  const uid = slug || model;
  if (uid !== COURSE_ASSIGNMENT_MODEL) return null;
  return <FilterCore />;
}

// ─── Core implementation ──────────────────────────────────────────────────────

function FilterCore() {
  const values     = useForm('CourseAssignmentCompanyFilter', (s) => s?.values, false);
  const { get }    = useFetchClient();

  const targetType    = normalizeTargetType(values?.assignment_target_type);
  const company       = values?.company;
  const companyId     = extractCompanyId(company);
  const isCompanyMode = targetType === 'Company';

  /**
   * allowedKeys:
   *   null -> filter inactive
   *   Set  -> allowed course ids/documentIds/titles (lowercased)
   */
  const [allowedKeys, setAllowedKeys] = useState(null);
  const lastFetchedId = useRef(null);
  const observerRef   = useRef(null);
  const timerRef      = useRef(null);
  const fetchPatchedRef = useRef(false);
  const originalFetchRef = useRef(null);

  // ── 1. Fetch courses for the selected company via dedicated admin endpoint ─
  useEffect(() => {
    if (!isCompanyMode || !companyId) {
      setAllowedKeys(null);
      lastFetchedId.current = null;
      return;
    }

    if (lastFetchedId.current === companyId) return;
    lastFetchedId.current = companyId;

    (async () => {
      try {
        const res = await get(
          `/content-manager/collection-types/api::course.course` +
          `?fields[0]=title&fields[1]=id&fields[2]=documentId` +
          `&populate[company][fields][0]=id&populate[company][fields][1]=documentId` +
          `&pageSize=300&page=1`
        );

        const results = res?.data?.results ?? res?.data?.data ?? [];
        const keys    = new Set();
        const wanted = String(companyId);

        for (const c of (Array.isArray(results) ? results : [])) {
          const companyIds = getCourseCompanyIds(c);
          const belongs = companyIds.some((id) => String(id) === wanted);
          if (!belongs) continue;

          collectCourseKeys(c).forEach((k) => keys.add(k));
        }

        setAllowedKeys(keys);
      } catch (err) {
        console.warn('[CourseAssignmentCompanyFilter] fetch failed:', err?.message);
        // On error stay as null so we don't accidentally hide everything
        setAllowedKeys(null);
        lastFetchedId.current = null; // allow retry
      }
    })();
  }, [isCompanyMode, companyId, get]);

  // ── 1b. Intercept relation API response and filter results deterministically ─
  useEffect(() => {
    if (fetchPatchedRef.current) return;
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      try {
        const input = args[0];
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : input instanceof URL
                ? input.toString()
                : '';
        const isCourseRelationEndpoint =
          url.includes('/content-manager/relations/api::course-assignment.course-assignment/courses');

        if (!isCourseRelationEndpoint) return response;
        if (!isCompanyMode || !(allowedKeys instanceof Set)) return response;

        const cloned = response.clone();
        const contentType = cloned.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json')) return response;

        const body = await cloned.json();

        if (Array.isArray(body?.results)) {
          body.results = body.results.filter((item) => courseAllowedByKeys(item, allowedKeys));
        }

        if (body?.data && Array.isArray(body.data.results)) {
          body.data.results = body.data.results.filter((item) => courseAllowedByKeys(item, allowedKeys));
        }

        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(JSON.stringify(body), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return response;
      }
    };

    fetchPatchedRef.current = true;

    return () => {
      if (originalFetchRef.current) {
        window.fetch = originalFetchRef.current;
      }
      fetchPatchedRef.current = false;
    };
  }, [isCompanyMode, allowedKeys]);

  // ── 2. Inject hide-style once ──────────────────────────────────────────────
  useEffect(() => {
    if (!document.getElementById(STYLE_ID)) {
      const st       = document.createElement('style');
      st.id          = STYLE_ID;
      st.textContent = `[data-ca-hidden="true"]{display:none!important}`;
      document.head.appendChild(st);
    }
    return () => {
      document.querySelectorAll('[data-ca-hidden]').forEach((el) =>
        el.removeAttribute('data-ca-hidden')
      );
    };
  }, []);

  // ── 3. DOM filter ──────────────────────────────────────────────────────────
  const applyFilter = useCallback(() => {
    if (!isCompanyMode || allowedKeys === null) {
      // No filter active — reveal everything
      document.querySelectorAll('[data-ca-hidden]').forEach((el) =>
        el.removeAttribute('data-ca-hidden')
      );
      return;
    }

    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
      (d) => (d instanceof HTMLElement ? d.offsetParent !== null : true)
    );
    if (dialogs.length === 0) return;

    for (const dialog of dialogs) {
      // Collect every candidate row (tr, role=row, role=option, li)
      const rows = new Set([
        ...dialog.querySelectorAll('tr'),
        ...dialog.querySelectorAll('[role="option"]'),
        ...dialog.querySelectorAll('[role="row"]'),
        ...dialog.querySelectorAll('li'),
      ]);

      for (const row of rows) {
        // Skip header rows
        if (row.querySelector('th,[role="columnheader"]')) continue;

        // Collect ALL leaf text segments — one of them should be the course title
        const segments = [...row.querySelectorAll('span,p,td,div,strong,label,a')]
          .filter((el) => el.childElementCount === 0)
          .map((el) => (el.textContent ?? '').trim().toLowerCase())
          .filter((t) =>
            t.length > 1 &&
            !/^(\d+|true|false|draft|published|modified|select|add|remove|delete|edit|close|cancel|search)$/i.test(t)
          );

        if (segments.length === 0) continue;

        // A row is allowed if ANY segment matches an allowed key
        const isAllowed = segments.some((seg) => allowedKeys.has(seg));

        if (isAllowed) {
          row.removeAttribute('data-ca-hidden');
        } else {
          row.setAttribute('data-ca-hidden', 'true');
        }
      }
    }
  }, [isCompanyMode, allowedKeys]);

  // ── 4. MutationObserver ────────────────────────────────────────────────────
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!isCompanyMode || allowedKeys === null) {
      document.querySelectorAll('[data-ca-hidden]').forEach((el) =>
        el.removeAttribute('data-ca-hidden')
      );
      return;
    }

    const debounced = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(applyFilter, DEBOUNCE_MS);
    };

    const obs = new MutationObserver(debounced);
    obs.observe(document.body, { childList: true, subtree: true });
    observerRef.current = obs;

    applyFilter(); // run immediately in case dialog is already open

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      obs.disconnect();
      observerRef.current = null;
    };
  }, [isCompanyMode, allowedKeys, applyFilter]);

  return null;
}
