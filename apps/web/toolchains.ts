import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * The code runner's real Python (Pyodide) and C compiler (@yowasp/clang) are npm dependencies of
 * packages/runner. This plugin serves them from this site at /toolchains/<name>/ while developing
 * and copies them into dist/toolchains/ on build, so the runner never needs a CDN.
 */

const runnerRequire = createRequire(resolve(__dirname, '../../packages/runner/package.json'));

interface Toolchain {
  name: string;
  dir: string;
  /** Only these files are served/copied (skips source maps, typings, demo pages). */
  include: (file: string) => boolean;
}

const TOOLCHAINS: Toolchain[] = [
  {
    name: 'pyodide',
    dir: dirname(runnerRequire.resolve('pyodide/package.json')),
    include: (f) => /\.(mjs|wasm|zip|json)$/.test(f) && f !== 'package.json',
  },
  {
    name: 'clang',
    // The package only exports its bundle; everything it loads sits next to it in gen/.
    dir: dirname(runnerRequire.resolve('@yowasp/clang')),
    include: (f) => /\.(js|wasm|tar)$/.test(f),
  },
];

const TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
};

export function toolchains(): Plugin {
  let outDir = 'dist';
  return {
    name: 'oslab-toolchains',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/toolchains\/([^/]+)\/([^/?#]+)/.exec(req.url ?? '');
        const chain = m && TOOLCHAINS.find((t) => t.name === m[1]);
        const file = m?.[2];
        if (!chain || !file || !chain.include(file)) return next();
        const path = join(chain.dir, file);
        if (!existsSync(path)) return next();
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Content-Length', statSync(path).size);
        createReadStream(path).pipe(res);
      });
    },
    closeBundle() {
      for (const chain of TOOLCHAINS) {
        const target = join(outDir, 'toolchains', chain.name);
        mkdirSync(target, { recursive: true });
        for (const file of readdirSync(chain.dir).filter(chain.include)) {
          copyFileSync(join(chain.dir, file), join(target, file));
        }
      }
    },
  };
}
