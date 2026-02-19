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
  // Sync only the 3 repeatables to N entries (one per language). Do not sync inner repeatables (quiz_questions, feedback_question, etc.).
  const syncedModules = syncComponentArray(values.modules, languages, (lang) => createModulePlaceholder(lang));
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
    return languages.map((lang, i) => createPlaceholder(lang, i));
  }
  if (current.length < N) return null;
  const remainder = current.length % N;
  if (remainder !== 1) return null; // length = k*N + 1 means they added one
  const kept = current.slice(0, current.length - 1);
  const newEntries = languages.map((lang, i) => createPlaceholder(lang, i));
  return [...kept, ...newEntries];
}

/**
 * Injected into content-manager editView.right-links.
 * Syncs only the 3 repeatables (modules, quiz, feedback) to one entry per language.
 * Inner repeatables (quiz_questions, feedback_question, etc.) are not synced – only ensured as arrays.
 */
function CourseLanguageSyncOnSelect({ slug, model }) {
  const uid = slug || model;
  if (uid !== COURSE_MODEL) return null;

  const values = useForm('useContentManagerContext', (state) => state.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state.setValues, false);
  const modLen = useForm('useContentManagerContext', (s) => s.values?.modules?.length ?? 0, false);
  const quizLen = useForm('useContentManagerContext', (s) => s.values?.quiz?.length ?? 0, false);
  const fbLen = useForm('useContentManagerContext', (s) => s.values?.feedback?.length ?? 0, false);
  if (values === undefined || setValues === undefined) return null;
  const prevLangStrRef = useRef(null);
  const isFirstMount = useRef(true);
  const prevLengthsRef = useRef({ modules: 0, quiz: 0, feedback: 0 });

  const courseLanguage = values?.course_language;
  const languages = getLanguageList(courseLanguage);
  const N = languages.length;

  // Sync when course_language selection changes (or first mount)
  useEffect(() => {
    const currStr = JSON.stringify(languages);
    const langListChanged = prevLangStrRef.current !== currStr;
    const shouldSync =
      N > 0 && (isFirstMount.current ? true : langListChanged);

    if (shouldSync) {
      isFirstMount.current = false;
      prevLangStrRef.current = currStr;
      const next = buildSyncedValues(values || {}, languages);
      setValues(next);
      prevLengthsRef.current = {
        modules: next.modules?.length ?? 0,
        quiz: next.quiz?.length ?? 0,
        feedback: next.feedback?.length ?? 0,
      };
    } else if (N === 0) {
      prevLangStrRef.current = currStr;
    }
  }, [courseLanguage, values, setValues]);

  // When user clicks "Add new entry", expand that single new block to N blocks (one per language).
  // Defer setValues so it runs after the form's "add row" update is committed (avoids being overwritten).
  // For quiz and feedback, PREVENT expansion - we don't want users manually adding entries
  useEffect(() => {
    if (N <= 0 || !values) return;

    const prev = prevLengthsRef.current;

    const needsExpand =
      (modLen === prev.modules + 1 && modLen % N === 1) ||
      (quizLen === prev.quiz + 1 && quizLen % N === 1) ||
      (fbLen === prev.feedback + 1 && fbLen % N === 1);

    if (!needsExpand) {
      prev.modules = modLen;
      prev.quiz = quizLen;
      prev.feedback = fbLen;
      return;
    }

    let nextValues = { ...values };
    let didUpdate = false;

    // MODULES: Allow expansion (users can add module sets)
    if (modLen === prev.modules + 1 && modLen % N === 1) {
      const expanded = expandLastSetToLanguages(
        values.modules,
        languages,
        (lang) => createModulePlaceholder(lang)
      );
      if (expanded) {
        nextValues = { ...nextValues, modules: expanded };
        prev.modules = expanded.length;
        didUpdate = true;
      }
    } else {
      prev.modules = modLen;
    }

    // QUIZ: BLOCK manual additions
    if (quizLen === prev.quiz + 1) {
      const trimmed = ensureArray(values.quiz).slice(0, prev.quiz);
      nextValues = { ...nextValues, quiz: trimmed.map((q) => ({ ...q, quiz_questions: ensureArray(q.quiz_questions), quiz_instruction: ensureArray(q.quiz_instruction), quiz_instruction_checklist: ensureArray(q.quiz_instruction_checklist) })) };
      prev.quiz = trimmed.length;
      didUpdate = true;
    } else {
      prev.quiz = quizLen;
    }

    // FEEDBACK: Expand like modules – one entry per language (inner feedback_question not expanded)
    if (fbLen === prev.feedback + 1 && fbLen % N === 1) {
      const expanded = expandLastSetToLanguages(
        ensureArray(values.feedback),
        languages,
        (lang) => createFeedbackPlaceholder(lang)
      );
      if (expanded) {
        nextValues = { ...nextValues, feedback: expanded.map((f) => ({ ...f, feedback_question: ensureArray(f.feedback_question) })) };
        prev.feedback = expanded.length;
        didUpdate = true;
      }
    } else {
      prev.feedback = fbLen;
    }

    if (didUpdate) {
      const payload = { ...nextValues };
      // Ensure repeatables stay arrays for any path that might have received non-array
      payload.modules = ensureArray(payload.modules);
      payload.quiz = ensureArray(payload.quiz).map((q) => ({ ...q, quiz_questions: ensureArray(q.quiz_questions), quiz_instruction: ensureArray(q.quiz_instruction), quiz_instruction_checklist: ensureArray(q.quiz_instruction_checklist) }));
      payload.feedback = ensureArray(payload.feedback).map((f) => ({ ...f, feedback_question: ensureArray(f.feedback_question) }));
      setTimeout(() => setValues(payload), 10);
    }
  }, [modLen, quizLen, fbLen, N, values, setValues, languages]);

  return null;
}

export default CourseLanguageSyncOnSelect;
