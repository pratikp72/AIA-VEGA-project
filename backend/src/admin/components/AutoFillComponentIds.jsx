/**
 * Fills component id fields (module_id, quiz_id, question_id, route_id, stop_id, etc.)
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
    // Top-level module_id is assigned by CourseLanguageSyncOnSelect to avoid race conditions on add-entry fanout.
    modules: { nested: {} },
    quiz: {
      // Top-level quiz_id is assigned by CourseLanguageSyncOnSelect to avoid race conditions on add-entry fanout.
      nested: {
        quiz_questions: { idKey: 'question_id', prefix: 'q', nested: {} },
      },
    },
    // feedback is single component; feedback_question is inside it (repeatable)
    feedback: {
      nested: {
        feedback_question: { idKey: 'question_id', prefix: 'fb', nested: {} },
      },
    },
  },
  'api::unit-location.unit-location': {
    Units: {
      // Each Unit is an object with routes array
      nested: {
        routes: {
          idKey: 'route_id',
          prefix: 'route',
          nested: {
            bus_stops: {
              idKey: 'stop_id',
              prefix: 'stop',
              nested: {
                bus_shifts: {
                  idKey: 'shift_id', // If shift_id is needed, otherwise remove
                  prefix: 'shift',
                  nested: {},
                },
              },
            },
          },
        },
      },
    },
  },
};

function fillIdsInObject(obj, config, didFillRef) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, spec] of Object.entries(config)) {
    if (!spec) continue;
    const val = obj[key];
    // Nested only, single object (e.g. old feedback as single)
    if (spec.nested && Object.keys(spec.nested).length > 0 && !spec.idKey && val && typeof val === 'object' && !Array.isArray(val)) {
      fillIdsInObject(val, spec.nested, didFillRef);
      continue;
    }
    // Nested only, repeatable (e.g. feedback: array of { feedback_question: ... })
    if (spec.nested && Object.keys(spec.nested).length > 0 && !spec.idKey && Array.isArray(val)) {
      val.forEach((item) => fillIdsInObject(item, spec.nested, didFillRef));
      continue;
    }
    if (!spec.idKey) continue;
    const arr = val;
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
function AutoFillComponentIds({ slug, model }) {
  const uid = slug || model;
  const config = uid ? CONTENT_TYPE_ID_CONFIG[uid] : null;
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
  }, [uid, values, setValues, config]);

  return null;
}

export default AutoFillComponentIds;
