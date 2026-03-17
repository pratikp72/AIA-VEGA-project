import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const WORKFLOW_MODEL = 'api::course-workflow.course-workflow';
const STYLE_ID = 'wf-module-idx-style';

function isBefore(a, b) {
  return Boolean(a?.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function findModuleLabelTarget(btn) {
  const leafs = [...btn.querySelectorAll('span, p, div, strong, label')].filter(
    (el) => el.childElementCount === 0 && (el.textContent || '').trim().length > 0
  );

  const candidates = leafs.filter((el) => {
    const txt = (el.textContent || '').trim();
    if (!txt) return false;
    if (/^\d+$/.test(txt)) return false;
    if (/^[^a-zA-Z0-9]+$/.test(txt)) return false;
    if (/^(delete|remove|menu)$/i.test(txt)) return false;
    return true;
  });

  return candidates[candidates.length - 1] || null;
}

function CourseWorkflowModuleIndexLabel({ slug, model }) {
  const uid = slug || model;
  // Re-run labeling whenever modules array length changes
  useForm('CourseWorkflowModuleIndexLabel', (s) => {
    const m = s?.values?.modules;
    return Array.isArray(m) ? m.length : 0;
  }, false);

  const timerRef = useRef(null);

  useEffect(() => {
    if (uid !== WORKFLOW_MODEL) return;

    // Inject CSS once — ::before prepends "(N) - " on the module label text
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = `
        [data-wf-module-idx-label]::before {
          content: "Module (" attr(data-wf-module-idx-label) ") - ";
          font-weight: 600;
        }
      `;
      document.head.appendChild(st);
    }

    function applyLabels() {
      // 1. Find "modules (N)" heading — search ALL element types (not just span/p)
      let heading = null;
      for (const el of document.querySelectorAll('span, p, h1, h2, h3, h4, h5, h6, div, label, strong')) {
        if (el.childElementCount > 0) continue;
        if (/^modules\s*\(\d+\)$/i.test((el.textContent || '').trim())) {
          heading = el;
          break;
        }
      }
      if (!heading) return;

      // 2. Find the field boundary marker (either add-entry button or empty-state button)
      const addEntryBtn = [...document.querySelectorAll('button')].find((btn) =>
        /add\s+an\s+entry|click\s+to\s+add\s+one/i.test((btn.textContent || '').trim())
      );

      // 3. Walk up to find the field section that owns the module accordion entries
      let wrapper = heading;
      let moduleBtns = [];

      for (let i = 0; i < 20; i++) {
        wrapper = wrapper.parentElement;
        if (!wrapper || wrapper === document.body) break;

        const allBtns = [...wrapper.querySelectorAll('button[aria-expanded]')].filter((btn) => {
          if (!isBefore(heading, btn)) return false;
          if (addEntryBtn && !isBefore(btn, addEntryBtn)) return false;
          return true;
        });
        if (allBtns.length === 0) continue;

        // Pick only the SHALLOWEST buttons (direct module entries, not nested component triggers)
        const withDepth = allBtns.map((btn) => {
          let d = 0;
          let p = btn;
          while (p && p !== wrapper) { p = p.parentElement; d++; }
          return { btn, d };
        });
        const minD = Math.min(...withDepth.map((x) => x.d));
        const topLevel = withDepth.filter((x) => x.d === minD).map((x) => x.btn);

        if (topLevel.length > 0) {
          moduleBtns = topLevel;
          break;
        }
      }

      if (moduleBtns.length === 0) return;

      // 3. Clear stale labels
      document
        .querySelectorAll('[data-wf-module-idx], [data-wf-module-idx-btn], [data-wf-module-idx-label]')
        .forEach((el) => {
          el.removeAttribute('data-wf-module-idx');
          el.removeAttribute('data-wf-module-idx-btn');
          el.removeAttribute('data-wf-module-idx-label');
        });

      // 5. Stamp each module header label with the 1-based index
      moduleBtns.forEach((btn, idx) => {
        const target = findModuleLabelTarget(btn);
        if (!target) return;
        target.setAttribute('data-wf-module-idx-label', String(idx + 1));
      });
    }

    function scheduleApply() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(applyLabels, 100);
    }

    // attribute changes (our own setAttribute) do NOT use 'attributes: true',
    // so the observer won't loop when we stamp data-wf-module-idx.
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });

    scheduleApply();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      observer.disconnect();
      document
        .querySelectorAll('[data-wf-module-idx], [data-wf-module-idx-btn], [data-wf-module-idx-label]')
        .forEach((el) => {
          el.removeAttribute('data-wf-module-idx');
          el.removeAttribute('data-wf-module-idx-btn');
          el.removeAttribute('data-wf-module-idx-label');
        });
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [uid]);

  return null;
}

export default CourseWorkflowModuleIndexLabel;
