/**
 * Fills component id fields (module_id, quiz_id, question_id, route_id, bus_stop_id)
 * in the form as soon as the user adds a new component entry, so ids appear before save.
 * Uses the same prefixes as the server-side auto-generate (mod, quiz, q, fb, route, stop).
 */

import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Config per content-type: key = form field name (component array),
 * value = { idKey, prefix, nested?: { key: { idKey, prefix, nested? } } }
 */
const CONTENT_TYPE_ID_CONFIG = {
  'api::course.course': {
    modules: { idKey: 'module_id', prefix: 'mod', nested: {} },
    quiz: {
      idKey: 'quiz_id',
      prefix: 'quiz',
      nested: {
        quiz_questions: { idKey: 'question_id', prefix: 'q', nested: {} },
      },
    },
    feedback_question: { idKey: 'question_id', prefix: 'fb', nested: {} },
  },
  'api::unit-location.unit-location': {
    bus_routes: {
      idKey: 'route_id',
      prefix: 'route',
      nested: {
        route_stops: { idKey: 'bus_stop_id', prefix: 'stop', nested: {} },
      },
    },
  },
};

function fillIdsInObject(obj, config, didFillRef) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, spec] of Object.entries(config)) {
    if (!spec || !spec.idKey) continue;
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (!item || typeof item !== 'object') continue;
      const current = item[spec.idKey];
      if (current === undefined || current === null || String(current).trim() === '') {
        item[spec.idKey] = generateId(spec.prefix);
        didFillRef.current = true;
      }
      if (spec.nested && Object.keys(spec.nested).length > 0) {
        fillIdsInObject(item, spec.nested, didFillRef);
      }
    }
  }
}

/**
 * Injected into content-manager editView. For content types that have component id fields,
 * fills missing ids whenever form values change (e.g. user added a new component row).
 */
function AutoFillComponentIds({ slug }) {
  const config = slug ? CONTENT_TYPE_ID_CONFIG[slug] : null;
  const values = useForm('useContentManagerContext', (state) => state.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state.setValues, false);
  const didFillRef = useRef(false);

  useEffect(() => {
    if (!config || !values || typeof setValues !== 'function') return;

    didFillRef.current = false;
    const copy = JSON.parse(JSON.stringify(values));
    fillIdsInObject(copy, config, didFillRef);

    if (didFillRef.current) {
      setValues(copy);
    }
  }, [slug, values, setValues, config]);

  return null;
}

export default AutoFillComponentIds;
