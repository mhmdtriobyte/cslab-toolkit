/**
 * The real interpreters are large, so they are not bundled: they load from jsDelivr the first time a
 * student presses Run, and the service worker caches them for offline use afterwards.
 */
export const PYODIDE_URL = 'https://cdn.jsdelivr.net/npm/pyodide@314.0.7/';
export const CLANG_URL =
  'https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/bundle.js';
