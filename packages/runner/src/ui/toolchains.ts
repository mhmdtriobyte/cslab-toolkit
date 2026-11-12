/**
 * The real Python and C toolchains are npm dependencies of this package. The web app serves them
 * from its own origin at /toolchains/ (see apps/web/toolchains.ts), so nothing comes from a CDN.
 * They are only downloaded the first time a student presses Run, then cached for offline use.
 */
const base = (name: string) => new URL(`/toolchains/${name}/`, self.location.origin).href;

export const PYODIDE_URL = base('pyodide');
export const CLANG_URL = `${base('clang')}bundle.js`;
