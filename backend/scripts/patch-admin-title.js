'use strict';

/**
 * Patches .strapi/client/index.html after `strapi build`.
 * Replaces "Strapi Admin" title with "AIA-VEGA Admin" and injects
 * an early inline script that intercepts all subsequent title writes
 * so the tab never flashes "Strapi Admin".
 *
 * Run automatically via the `postbuild` npm script.
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '.strapi', 'client', 'index.html');

if (!fs.existsSync(HTML_PATH)) {
  console.error('[patch-admin-title] File not found:', HTML_PATH);
  process.exit(0); // Non-fatal — dev mode doesn't always produce this file
}

let html = fs.readFileSync(HTML_PATH, 'utf8');

// 1. Replace the <title> tag
html = html.replace(/<title>[^<]*<\/title>/i, '<title>AIA-VEGA Admin</title>');

// 2. Inject early intercept script immediately after <head> opening tag
//    Only inject once (idempotent re-runs)
const INJECT_MARKER = 'data-aia-title-patch="1"';
if (!html.includes(INJECT_MARKER)) {
  const inlineScript = `
  <script ${INJECT_MARKER}>
    (function () {
      // Immediately correct title if Strapi set it before this script ran
      var titleEl = document.getElementsByTagName('title')[0];
      if (titleEl && /strapi/i.test(titleEl.textContent)) {
        titleEl.textContent = 'AIA-VEGA Admin';
      }
      // Intercept document.title = '...' assignments
      try {
        Object.defineProperty(document, 'title', {
          set: function (v) {
            document.getElementsByTagName('title')[0].textContent =
              (v || '').replace(/Strapi/gi, 'AIA-VEGA');
          },
          get: function () {
            return document.getElementsByTagName('title')[0].textContent;
          },
          configurable: true,
        });
      } catch (e) {}
      // Watch for direct DOM mutations on <title>
      if (titleEl && window.MutationObserver) {
        new MutationObserver(function (ms) {
          ms.forEach(function (m) {
            var t = (m.target || titleEl).textContent || '';
            if (/strapi/i.test(t)) {
              (m.target || titleEl).textContent = t.replace(/Strapi/gi, 'AIA-VEGA');
            }
          });
        }).observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
    })();
  </script>`;

  html = html.replace('<head>', '<head>' + inlineScript);
}

fs.writeFileSync(HTML_PATH, html, 'utf8');
console.log('[patch-admin-title] Patched:', HTML_PATH);
