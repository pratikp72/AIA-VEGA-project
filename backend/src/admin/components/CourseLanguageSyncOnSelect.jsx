// One entry per language for quiz/feedback/orientation. When removing languages, entries for removed languages are dropped.
function syncComponentArray(current, languages, createPlaceholder) {
  const N = languages.length;
  const list = Array.isArray(current) ? [...current] : [];

  if (N === 0) return []; // no languages = remove all entries
  const out = [];

  for (let i = 0; i < N; i++) {
    const lang = languages[i];
    if (list[i]) {
      out.push({ ...list[i], language: lang });
    } else {
      const entry = createPlaceholder(lang, i);
      if (!entry.__temp_key__) {
        entry.__temp_key__ = `lang-${lang}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
      out.push(entry);
    }
  }

  return out;
}
/**
 * When the Course edit view is open and the user changes "Course language",
 * this syncs the 3 repeatables (modules, quiz, feedback) to one entry per
 * language. Inner repeatables (quiz_questions, feedback_question, etc.) are
 * not synced – only the top-level 3 component entries are created per language.
 */

import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_MODEL = 'api::course.course';
const LANGUAGES = ['English', 'Hindi', 'Gujarati'];

function getLanguageList(raw) {
  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  const langLower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
  const matchLang = (v) => {
    const s = typeof v === 'object' && v != null && typeof v.value === 'string' ? v.value : v;
    if (typeof s !== 'string') return null;
    const lower = langLower(s);
    return LANGUAGES.find((l) => langLower(l) === lower) || null;
  };
  const out = [];
  for (const v of arr) {
    const matched = matchLang(v);
    if (matched && !out.includes(matched)) out.push(matched);
  }
  return out;
}

function normalizeLang(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function cloneWithoutKeys(obj, keys) {
  const out = { ...(obj || {}) };
  (keys || []).forEach((k) => {
    if (k in out) delete out[k];
  });
  return out;
}

// For modules: keep "blocks" of entries per module, one entry per language per block.
// Storage shape becomes: [mod1-en, mod1-hi, mod1-gu, mod2-en, mod2-hi, mod2-gu, ...]
// When removing languages: entries for removed languages are dropped from each block.
function syncModuleBlocks(current, prevLanguages, nextLanguages, createPlaceholder) {
  const nextN = nextLanguages.length;
  const list = Array.isArray(current) ? [...current] : [];

  // When no languages selected: remove all entries (or keep as-is if that's preferred)
  if (nextN === 0) return [];

  // If empty, create the first module block (one per language)
  if (list.length === 0) {
    return nextLanguages.map((lang, i) => createPlaceholder(lang, i));
  }

  // Infer block size: when reducing languages, use prevLanguages; otherwise infer from list.
  const prevLangN = Array.isArray(prevLanguages) && prevLanguages.length > 0 ? prevLanguages.length : nextN;
  let prevN;
  if (nextN < prevLangN && list.length % prevLangN === 0) {
    prevN = prevLangN; // reducing: list has blocks of prevLangN (e.g. 6 modules = 2 blocks of 3)
  } else if (list.length % nextN === 0 && list.length >= nextN) {
    prevN = nextN; // list is k blocks of nextN
  } else {
    prevN = list.length; // one block (e.g. adding languages)
  }

  // Chunk into blocks of prevN.
  const blocks = [];
  if (prevN > 0 && list.length % prevN === 0) {
    for (let i = 0; i < list.length; i += prevN) {
      blocks.push(list.slice(i, i + prevN));
    }
  } else {
    blocks.push(list);
  }

  const out = [];

  blocks.forEach((block, blockIdx) => {
    // index by language for best preservation when removing/adding languages
    const byLang = new Map();
    block.forEach((m) => {
      const key = normalizeLang(m?.language);
      if (key) byLang.set(key, m);
    });

    nextLanguages.forEach((lang, langIdx) => {
      const found = byLang.get(normalizeLang(lang));
      if (found) {
        out.push({ ...found, language: lang });
      } else {
        // New language added: create a clean placeholder (do not clone IDs from another language)
        out.push(createPlaceholder(lang, langIdx));
      }

      const last = out[out.length - 1];
      if (last && !last.__temp_key__) {
        last.__temp_key__ = `mod-${blockIdx}-${langIdx}-lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
    });
  });

  return out;
}

function createModulePlaceholder(lang) {
  return {
    __temp_key__: `lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    module_id: '',
    title: '',
    module_content_type: 'Text',
    mark_as_read: false,
    module_duration_min: 1,
  };
}

function createQuizPlaceholder(lang) {
  return {
    __temp_key__: `lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    title: '',
    quiz_questions: [],
    quiz_instruction: [],
    quiz_instruction_checklist: [],
  };
}

function createFeedbackPlaceholder(lang) {
  return {
    __temp_key__: `lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    feedback_question: [],
  };
}

function createOrientationPlaceholder(lang) {
  return {
    __temp_key__: `orient-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    orientation_flow: 'Before Course Completion',
    trainer_name: '',
    topics_to_cover: [],
  };
}

function ensureArray(val) {
  return Array.isArray(val) ? val : [];
}

function buildSyncedValues(values, nextLanguages, prevLanguages) {
  // For modules: blocks (supports add-entry); for quiz/feedback: one entry per language
  const syncedModules = syncModuleBlocks(values.modules, prevLanguages, nextLanguages, (lang) => createModulePlaceholder(lang));
  const syncedQuiz = syncComponentArray(values.quiz, nextLanguages, (lang) => createQuizPlaceholder(lang));
  const syncedFeedback = syncComponentArray(values.feedback, nextLanguages, (lang) => createFeedbackPlaceholder(lang));
  const orientationRequired = values.orientation_required === true;
  const syncedOrientation = orientationRequired
    ? syncComponentArray(values.orientation_detail, nextLanguages, (lang) => createOrientationPlaceholder(lang))
    : ensureArray(values.orientation_detail);

  // Ensure every repeatable value is an array and nested repeatables are arrays (avoids value.map is not a function)
  const normalizedModules = ensureArray(syncedModules);
  const normalizedQuiz = ensureArray(syncedQuiz).map((q) => ({
    ...q,
    quiz_questions: ensureArray(q.quiz_questions),
    quiz_instruction: ensureArray(q.quiz_instruction),
    quiz_instruction_checklist: ensureArray(q.quiz_instruction_checklist),
  }));
  const normalizedFeedback = ensureArray(syncedFeedback).map((f) => ({
    ...f,
    feedback_question: ensureArray(f.feedback_question),
  }));
  const normalizedOrientation = ensureArray(syncedOrientation);

  return {
    ...values,
    modules: normalizedModules,
    quiz: normalizedQuiz,
    feedback: normalizedFeedback,
    orientation_detail: normalizedOrientation,
  };
}

/** When user added exactly one entry, expand it to N entries (one per language). */
function expandLastSetToLanguages(current, languages, createPlaceholder) {
  const N = languages.length;
  if (N <= 0 || !Array.isArray(current)) return null;
  // First add: 0 -> 1 entry => create N entries (one per language)
  if (current.length === 1 && N >= 1) {
    // Clone the first entry for each language
    return languages.map((lang, i) => ({ ...current[0], language: lang, __temp_key__: `lang-${lang}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }));
  }
  if (current.length < N) return null;
  const remainder = current.length % N;
  if (remainder !== 1) return null; // length = k*N + 1 means they added one
  const kept = current.slice(0, current.length - 1);
  const last = current[current.length - 1];
  // Clone the last added entry for each language
  const newEntries = languages.map((lang, i) => ({ ...last, language: lang, __temp_key__: `lang-${lang}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }));
  return [...kept, ...newEntries];
}

function expandLastModuleSetToLanguages(modules, languages) {
  const expanded = expandLastSetToLanguages(modules, languages);
  if (!expanded) return null;

  return expanded.map((m, idx) => {
    const base = typeof m === 'object' && m != null ? m : {};
    const cleaned = cloneWithoutKeys(base, ['module_id', '__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      module_id: '',
      module_duration_min: cleaned.module_duration_min ?? 1,
      __temp_key__: `mod-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

function expandLastQuizSetToLanguages(quiz, languages) {
  const expanded = expandLastSetToLanguages(quiz, languages);
  if (!expanded) return null;

  return expanded.map((q, idx) => {
    const base = typeof q === 'object' && q != null ? q : {};
    const cleaned = cloneWithoutKeys(base, ['quiz_id', '__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      quiz_id: '',
      quiz_questions: ensureArray(cleaned.quiz_questions),
      quiz_instruction: ensureArray(cleaned.quiz_instruction),
      quiz_instruction_checklist: ensureArray(cleaned.quiz_instruction_checklist),
      __temp_key__: `quiz-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

function expandLastFeedbackSetToLanguages(feedback, languages) {
  const expanded = expandLastSetToLanguages(feedback, languages);
  if (!expanded) return null;

  return expanded.map((f, idx) => {
    const base = typeof f === 'object' && f != null ? f : {};
    const cleaned = cloneWithoutKeys(base, ['__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      feedback_question: ensureArray(cleaned.feedback_question),
      __temp_key__: `fb-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

function expandLastOrientationSetToLanguages(orientation, languages) {
  const expanded = expandLastSetToLanguages(orientation, languages);
  if (!expanded) return null;

  return expanded.map((o, idx) => {
    const base = typeof o === 'object' && o != null ? o : {};
    const cleaned = cloneWithoutKeys(base, ['__temp_key__']);
    return {
      ...cleaned,
      language: cleaned.language,
      orientation_flow: cleaned.orientation_flow ?? 'Before Course Completion',
      trainer_name: cleaned.trainer_name ?? '',
      topics_to_cover: ensureArray(cleaned.topics_to_cover),
      __temp_key__: `orient-expand-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  });
}

/**
 * Injected into content-manager editView.right-links.
 * When user selects languages in Course language dropdown, auto-creates one entry per language for:
 * modules, quiz, feedback, and orientation_detail (when orientation is required).
 */
function CourseLanguageSyncOnSelect({ slug, model }) {
  const uid = slug || model;
  const values = useForm('useContentManagerContext', (state) => state?.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state?.setValues, false);
  const prevLangRef = useRef(null);
  const prevOrientationRequiredRef = useRef(null);
  const prevLengthsRef = useRef({
    modules: 0,
    quiz: 0,
    feedback: 0,
    orientation_detail: 0,
  });

  useEffect(() => {
    if (uid !== COURSE_MODEL || !values || typeof setValues !== 'function') return;

    const languages = getLanguageList(values.course_language);
    const N = languages.length;
    const modules = ensureArray(values.modules);
    const quiz = ensureArray(values.quiz);
    const feedback = ensureArray(values.feedback);
    const orientationRequired = values.orientation_required === true;
    const orientationDetail = ensureArray(values.orientation_detail);
    const prevLengths = prevLengthsRef.current;

    // 1. When course_language changed, sync all components (add/remove entries per language).
    const prevLang = prevLangRef.current;
    const prevKey = prevLang ? JSON.stringify(prevLang) : null;
    const currKey = JSON.stringify(languages);

    if (prevKey !== currKey) {
      prevLangRef.current = languages;
      prevOrientationRequiredRef.current = orientationRequired;
      const synced = buildSyncedValues(values, languages, prevLang);
      prevLengthsRef.current = {
        modules: synced.modules.length,
        quiz: synced.quiz.length,
        feedback: synced.feedback.length,
        orientation_detail: synced.orientation_detail.length,
      };
      setValues(synced);
      return;
    }

    // 2. When orientation_required changed from false to true: create orientation entries per selected language.
    const prevOrientationRequired = prevOrientationRequiredRef.current;
    if (orientationRequired && !prevOrientationRequired && N >= 1) {
      prevOrientationRequiredRef.current = orientationRequired;
      const synced = buildSyncedValues(values, languages, prevLang);
      prevLengthsRef.current = {
        modules: synced.modules.length,
        quiz: synced.quiz.length,
        feedback: synced.feedback.length,
        orientation_detail: synced.orientation_detail.length,
      };
      setValues(synced);
      return;
    }
    // When orientation_required changed from true to false: clear orientation entries.
    if (!orientationRequired && prevOrientationRequired) {
      prevOrientationRequiredRef.current = orientationRequired;
      prevLengthsRef.current = {
        modules: modules.length,
        quiz: quiz.length,
        feedback: feedback.length,
        orientation_detail: 0,
      };
      setValues({ ...values, orientation_detail: [] });
      return;
    }

    // 3. When user clicks "Add an entry", Strapi adds 1 row. Expand it to N rows (one per language).
    if (N >= 1 && modules.length >= 1 && modules.length === prevLengths.modules + 1 && modules.length % N === 1) {
      const expanded = expandLastModuleSetToLanguages(modules, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          modules: expanded.length,
        };
        setValues({ ...values, modules: expanded });
        return;
      }
    }
    if (N >= 1 && quiz.length >= 1 && quiz.length === prevLengths.quiz + 1 && quiz.length % N === 1) {
      const expanded = expandLastQuizSetToLanguages(quiz, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          quiz: expanded.length,
        };
        setValues({ ...values, quiz: expanded });
        return;
      }
    }
    if (N >= 1 && feedback.length >= 1 && feedback.length === prevLengths.feedback + 1 && feedback.length % N === 1) {
      const expanded = expandLastFeedbackSetToLanguages(feedback, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          feedback: expanded.length,
        };
        setValues({ ...values, feedback: expanded });
        return;
      }
    }
    if (
      orientationRequired &&
      N >= 1 &&
      orientationDetail.length >= 1 &&
      orientationDetail.length === prevLengths.orientation_detail + 1 &&
      orientationDetail.length % N === 1
    ) {
      const expanded = expandLastOrientationSetToLanguages(orientationDetail, languages);
      if (expanded) {
        prevLangRef.current = languages;
        prevLengthsRef.current = {
          ...prevLengths,
          orientation_detail: expanded.length,
        };
        setValues({ ...values, orientation_detail: expanded });
        return;
      }
    }

    prevOrientationRequiredRef.current = orientationRequired;
    prevLengthsRef.current = {
      modules: modules.length,
      quiz: quiz.length,
      feedback: feedback.length,
      orientation_detail: orientationDetail.length,
    };
  }, [uid, values, setValues]);

  return null;
}

export default CourseLanguageSyncOnSelect;
