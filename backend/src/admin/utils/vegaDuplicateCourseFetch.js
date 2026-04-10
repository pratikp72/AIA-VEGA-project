/**
 * Marks Content Manager saves that come from a duplicated course flow so the API can strip
 * course_assignments on create/update (second Save often sends relations only on PUT).
 */

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
