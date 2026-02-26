// Restore original syncComponentArray for quiz/feedback
function syncComponentArray(current, languages, createPlaceholder) {
  const N = languages.length;
  if (N === 0) return current;

  const list = Array.isArray(current) ? [...current] : [];
  const out = list.slice(0, N);

  for (let i = 0; i < N; i++) {
    const lang = languages[i];
    if (out[i]) {
      out[i] = { ...out[i], language: lang };
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
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === 'string' && LANGUAGES.includes(v));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((v) => typeof v === 'string' && LANGUAGES.includes(v))
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

// For modules: create all combinations of modules × languages
function syncModuleArray(current, languages, createPlaceholder) {
  if (!Array.isArray(current) || languages.length === 0) return [];
  const out = [];
  current.forEach((mod, modIdx) => {
    languages.forEach((lang, langIdx) => {
      // Copy module fields except language, assign language
      const entry = { ...mod, language: lang };
      if (!entry.__temp_key__) {
        entry.__temp_key__ = `mod-${modIdx}-lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
      out.push(entry);
    });
  });
  return out;
}

function createModulePlaceholder(lang) {
  return {
    __temp_key__: `lang-${lang}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    title: '',
    module_content_type: 'Text',
    mark_as_read: false,
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

function ensureArray(val) {
  return Array.isArray(val) ? val : [];
}

function buildSyncedValues(values, languages) {
  // For modules: create all module × language combinations
  const syncedModules = syncModuleArray(values.modules, languages, (lang) => createModulePlaceholder(lang));
  // For quiz/feedback: keep old logic (one per language)
  const syncedQuiz = syncComponentArray(values.quiz, languages, (lang) => createQuizPlaceholder(lang));
  const syncedFeedback = syncComponentArray(values.feedback, languages, (lang) => createFeedbackPlaceholder(lang));

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

  return {
    ...values,
    modules: normalizedModules,
    quiz: normalizedQuiz,
    feedback: normalizedFeedback,
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

/**
 * Injected into content-manager editView.right-links.
 * Syncs only the 3 repeatables (modules, quiz, feedback) to one entry per language.
 * Inner repeatables (quiz_questions, feedback_question, etc.) are not synced – only ensured as arrays.
 */
// Fully disabled: do not inject any language sync logic for any model
function CourseLanguageSyncOnSelect() {
  return null;
}

export default CourseLanguageSyncOnSelect;
