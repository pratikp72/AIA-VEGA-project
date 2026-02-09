'use strict';

const COURSE_UID = 'api::course.course';
const LANGUAGES = ['English', 'Hindi', 'Gujarati'];

/**
 * Normalize course_language to an array of strings (e.g. ["English", "Hindi"]).
 * @param {unknown} raw - From document (array, JSON string, or undefined)
 * @returns {string[]}
 */
function getLanguageList(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === 'string' && LANGUAGES.includes(v));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string' && LANGUAGES.includes(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Ensure an array has exactly N entries, each with a language label.
 * - If current.length < N: append new placeholder entries.
 * - If current.length > N: trim to N.
 * - Set language on each entry by index.
 *
 * @param {object[]} current - Existing component entries
 * @param {string[]} languages - e.g. ["English", "Hindi", "Gujarati"]
 * @param { (lang: string, index: number) => object } createPlaceholder - returns new entry for that language
 */
function syncComponentArray(current, languages, createPlaceholder) {
  const N = languages.length;
  if (N === 0) return current;

  const list = Array.isArray(current) ? [...current] : [];
  let out = list.slice(0, N);

  for (let i = 0; i < N; i++) {
    const lang = languages[i];
    if (out[i]) {
      out[i] = { ...out[i], language: lang };
    } else {
      out.push(createPlaceholder(lang, i));
    }
  }

  return out;
}

/**
 * Mutate course document data so modules, quiz, feedback_question
 * have exactly one entry per selected course_language, each with language set.
 * Call before create/update so the payload is saved with the right structure.
 *
 * @param {object} data - Course document payload (params.data)
 */
function syncCourseLanguageComponents(data) {
  const languages = getLanguageList(data?.course_language);
  if (languages.length === 0) return;

  data.modules = syncComponentArray(data.modules, languages, (lang) => ({
    language: lang,
    title: '',
    module_content_type: 'Text',
    mark_as_read: false,
  }));

  data.quiz = syncComponentArray(data.quiz, languages, (lang) => ({
    language: lang,
    title: '',
    quiz_questions: [],
    quiz_instruction: [],
    quiz_instruction_checklist: [],
  }));

  data.feedback_question = syncComponentArray(data.feedback_question, languages, (lang, index) => ({
    language: lang,
    question_id: `fb-${lang.toLowerCase()}-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    qestion: '',
    answer_type: 'Rating',
    mandatory: true,
  }));
}

module.exports = {
  syncCourseLanguageComponents,
  getLanguageList,
};
