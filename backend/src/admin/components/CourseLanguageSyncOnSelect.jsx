/**
 * When the Course edit view is open and the user changes "Course language"
 * (multi-select), this component syncs modules, quiz, and feedback_question
 * in the form so they have one entry per selected language (with language label).
 * Entries are created/updated immediately on selection change, without saving.
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

function createFeedbackPlaceholder(lang, index) {
  return {
    __temp_key__: `lang-${lang}-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    language: lang,
    question_id: `fb-${lang.toLowerCase()}-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    qestion: '',
    answer_type: 'Rating',
    mandatory: true,
  };
}

function buildSyncedValues(values, languages) {
  return {
    ...values,
    modules: syncComponentArray(values.modules, languages, (lang) => createModulePlaceholder(lang)),
    quiz: syncComponentArray(values.quiz, languages, (lang) => createQuizPlaceholder(lang)),
    feedback_question: syncComponentArray(
      values.feedback_question,
      languages,
      (lang, index) => createFeedbackPlaceholder(lang, index)
    ),
  };
}

/** When user added exactly one entry, expand it to N entries (one per language). */
function expandLastSetToLanguages(current, languages, createPlaceholder) {
  const N = languages.length;
  if (N <= 0 || !Array.isArray(current) || current.length < N) return null;
  const remainder = current.length % N;
  if (remainder !== 1) return null; // length = k*N + 1 means they added one
  const kept = current.slice(0, current.length - 1);
  const newEntries = languages.map((lang, i) => createPlaceholder(lang, i));
  return [...kept, ...newEntries];
}

/**
 * Injected into content-manager editView.right-links.
 * 1) When course_language changes, sync modules/quiz/feedback_question to one per language.
 * 2) When user clicks "Add new entry" on modules/quiz/feedback_question, expand to N blocks (one per language).
 */
function CourseLanguageSyncOnSelect({ slug }) {
  if (slug !== COURSE_MODEL) return null;

  const values = useForm('useContentManagerContext', (state) => state.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state.setValues, false);
  // Subscribe to array lengths so we re-render when user clicks "Add an entry"
  const modLen = useForm('useContentManagerContext', (s) => s.values?.modules?.length ?? 0, false);
  const quizLen = useForm('useContentManagerContext', (s) => s.values?.quiz?.length ?? 0, false);
  const fbLen = useForm('useContentManagerContext', (s) => s.values?.feedback_question?.length ?? 0, false);
  if (values === undefined || setValues === undefined) return null;
  const prevLangStrRef = useRef(null);
  const isFirstMount = useRef(true);
  const prevLengthsRef = useRef({ modules: 0, quiz: 0, feedback_question: 0 });

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
        feedback_question: next.feedback_question?.length ?? 0,
      };
    } else if (N === 0) {
      prevLangStrRef.current = currStr;
    }
  }, [courseLanguage, values, setValues]);

  // When user clicks "Add new entry", expand that single new block to N blocks (one per language).
  // Defer setValues so it runs after the form's "add row" update is committed (avoids being overwritten).
  useEffect(() => {
    if (N <= 0 || !values) return;

    const prev = prevLengthsRef.current;

    const needsExpand =
      (modLen === prev.modules + 1 && modLen % N === 1) ||
      (quizLen === prev.quiz + 1 && quizLen % N === 1) ||
      (fbLen === prev.feedback_question + 1 && fbLen % N === 1);

    if (!needsExpand) {
      prev.modules = modLen;
      prev.quiz = quizLen;
      prev.feedback_question = fbLen;
      return;
    }

    let nextValues = { ...values };
    let didUpdate = false;

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

    if (quizLen === prev.quiz + 1 && quizLen % N === 1) {
      const expanded = expandLastSetToLanguages(
        values.quiz,
        languages,
        (lang) => createQuizPlaceholder(lang)
      );
      if (expanded) {
        nextValues = { ...nextValues, quiz: expanded };
        prev.quiz = expanded.length;
        didUpdate = true;
      }
    } else {
      prev.quiz = quizLen;
    }

    if (fbLen === prev.feedback_question + 1 && fbLen % N === 1) {
      const expanded = expandLastSetToLanguages(
        values.feedback_question,
        languages,
        (lang, index) => createFeedbackPlaceholder(lang, index)
      );
      if (expanded) {
        nextValues = { ...nextValues, feedback_question: expanded };
        prev.feedback_question = expanded.length;
        didUpdate = true;
      }
    } else {
      prev.feedback_question = fbLen;
    }

    if (didUpdate) {
      const payload = { ...nextValues };
      // Defer so the form's addFieldRow has committed; then we overwrite with N blocks
      setTimeout(() => {
        setValues(payload);
      }, 10);
    }
  }, [modLen, quizLen, fbLen, N, values, setValues, languages]);

  return null;
}

export default CourseLanguageSyncOnSelect;
