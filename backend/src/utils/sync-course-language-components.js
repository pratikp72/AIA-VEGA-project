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
 * Mutate course document data so modules, quiz, and feedback.feedback_question
 * have exactly one entry per selected course_language. feedback is a single
 * component; feedback.feedback_question is the repeatable array we sync.
 *
 * @param {object} data - Course document payload (params.data)
 */
// Fully disabled: do not sync or mutate any course data. All repeatables are managed manually.
function syncCourseLanguageComponents(data) {
  // No-op: backend auto-sync is disabled by request.
  return;
}

module.exports = {
  syncCourseLanguageComponents,
  getLanguageList,
};
