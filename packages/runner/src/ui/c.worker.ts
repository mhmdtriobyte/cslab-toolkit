import { runC, type RunClang } from '../engine/cRunner';
import type { RunRequest, WorkerMessage } from '../engine/protocol';
import { CLANG_URL } from './cdn';

interface ClangModule {
  runClang: RunClang;
  /** With null args it only downloads the toolchain, reporting progress (runClang does not). */
  runLLVM: (
    args: null,
    files: object,
    options: { fetchProgress: (e: { totalLength: number; doneLength: number }) => void },
  ) => Promise<unknown>;
}

const post = (m: WorkerMessage) => self.postMessage(m);
let clang: Promise<RunClang> | null = null;

function load(): Promise<RunClang> {
  clang ??= (async () => {
    post({
      type: 'status',
      text: 'Downloading the C compiler (about 27 MB, only the first time)…',
    });
    const m = (await import(/* @vite-ignore */ CLANG_URL)) as ClangModule;
    let last = -1;
    await m.runLLVM(
      null,
      {},
      {
        fetchProgress: ({ totalLength, doneLength }) => {
          const pct = Math.floor((100 * doneLength) / Math.max(1, totalLength));
          if (pct === last) return;
          last = pct;
          post({
            type: 'status',
            text: `Downloading the C compiler (about 27 MB, only the first time)… ${pct}%`,
            progress: doneLength / Math.max(1, totalLength),
          });
        },
      },
    );
    return m.runClang;
  })();
  return clang;
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  try {
    await runC(await load(), e.data, post);
  } catch (err) {
    clang = null;
    post({ type: 'status', text: '' });
    post({
      type: 'done',
      exitCode: null,
      error: {
        message: `Could not run the C compiler: ${err instanceof Error ? err.message : String(err)}. The first run needs an internet connection.`,
        line: null,
      },
      trace: null,
      traceTruncated: false,
      ms: 0,
    });
  }
};
