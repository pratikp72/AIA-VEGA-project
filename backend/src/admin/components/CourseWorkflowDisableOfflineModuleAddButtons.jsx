import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_WORKFLOW_MODEL = 'api::course-workflow.course-workflow';
const DISABLED_ATTR = 'data-course-workflow-offline-module-add-disabled';
const STYLE_ID = 'course-workflow-offline-module-add-disabled-style';
const OFFLINE_MODULE_HEADING_RE = /^offline_module\s*(\(\d+\))?$/i;

function isInsideAccordionPanel(el) {
  let node = el?.parentElement || null;
  while (node && node !== document.body) {
    if (node.getAttribute('role') === 'region') return true;
    node = node.parentElement;
  }
  return false;
}

function isAddEntryControl(btn) {
  const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    /add\s+(an|another)\s+entry/.test(text) ||
    /click\s*to\s*add(\s+one)?/.test(text) ||
    /no\s+entry\s+yet/.test(text)
  );
}

function applyDisabledVisual(btn, tooltip) {
  btn.setAttribute(DISABLED_ATTR, 'true');
  btn.setAttribute('aria-disabled', 'true');
  btn.style.color = '#8e8ea9';
  btn.style.backgroundColor = '#f6f6f9';
  btn.style.borderColor = '#d9d9e3';
  btn.style.pointerEvents = 'auto';
  btn.style.cursor = 'not-allowed';
  btn.disabled = true;
  btn.title = tooltip;
}

function disableOfflineModuleAddButtons() {
  const tooltip = 'Offline module entries are managed automatically from selected users.';

  // We only target headings inside accordion panels, so top-level repeatables are not affected.
  const headings = [...document.querySelectorAll('span, p, label, strong, h1, h2, h3, h4, h5, h6')].filter((el) => {
    if (el.childElementCount !== 0) return false;
    if (!isInsideAccordionPanel(el)) return false;
    const txt = (el.textContent || '').trim();
    return OFFLINE_MODULE_HEADING_RE.test(txt);
  });

  for (const heading of headings) {
    let container = heading.parentElement;

    // Walk up to find the immediate field section that owns this offline_module block.
    for (let i = 0; i < 12; i++) {
      if (!container || container === document.body) break;

      const addBtns = [...container.querySelectorAll('button')].filter((btn) => {
        if (!isAddEntryControl(btn)) return false;
        if (!isInsideAccordionPanel(btn)) return false;
        // Keep it inside the same workflow module panel as heading.
        const headingPanel = heading.closest('[role="region"]');
        const buttonPanel = btn.closest('[role="region"]');
        return headingPanel && buttonPanel && headingPanel === buttonPanel;
      });

      if (addBtns.length > 0) {
        addBtns.forEach((btn) => applyDisabledVisual(btn, tooltip));
        break;
      }

      container = container.parentElement;
    }
  }
}

export default function CourseWorkflowDisableOfflineModuleAddButtons({ slug, model }) {
  const uid = slug || model;

  // Re-run when module list changes or module_type values toggle between Online/Offline.
  useForm(
    'CourseWorkflowDisableOfflineModuleAddButtons',
    (s) => {
      const modules = Array.isArray(s?.values?.modules) ? s.values.modules : [];
      return modules.map((m) => String(m?.module_type || '')).join('|');
    },
    false,
  );

  const timerRef = useRef(null);

  useEffect(() => {
    if (uid !== COURSE_WORKFLOW_MODEL) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        button[${DISABLED_ATTR}="true"],
        button[${DISABLED_ATTR}="true"]:hover,
        button[${DISABLED_ATTR}="true"]:focus {
          cursor: not-allowed !important;
          pointer-events: auto !important;
          color: #8e8ea9 !important;
          background: #f6f6f9 !important;
          border-color: #d9d9e3 !important;
          opacity: 1 !important;
        }

        button[${DISABLED_ATTR}="true"] *,
        button[${DISABLED_ATTR}="true"]:hover *,
        button[${DISABLED_ATTR}="true"]:focus * {
          color: #8e8ea9 !important;
        }

        button[${DISABLED_ATTR}="true"] svg,
        button[${DISABLED_ATTR}="true"] svg * {
          color: #8e8ea9 !important;
          fill: currentColor !important;
          stroke: currentColor !important;
        }
      `;
      document.head.appendChild(style);
    }

    function schedule() {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(disableOfflineModuleAddButtons, 200);
    }

    schedule();

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(timerRef.current);
    };
  }, [uid]);

  return null;
}
