import { PYTHON_HARNESS } from '../engine/pythonHarness';
import {
  MAX_OUTPUT,
  type RunRequest,
  type TraceStep,
  type WorkerMessage,
} from '../engine/protocol';
import { PYODIDE_URL } from './toolchains';

interface Pyodide {
  runPython(code: string): unknown;
  globals: { set(name: string, value: unknown): void };
}

const post = (m: WorkerMessage) => self.postMessage(m);

let ready: Promise<Pyodide> | null = null;

function load(): Promise<Pyodide> {
  ready ??= (async () => {
    post({ type: 'status', text: 'Downloading Python (about 6 MB, only the first time)…' });
    const mod = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as {
      loadPyodide: (o: { indexURL: string }) => Promise<Pyodide>;
    };
    const py = await mod.loadPyodide({ indexURL: PYODIDE_URL });
    return py;
  })();
  return ready;
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { code, stdin, trace } = e.data;
  let py: Pyodide;
  try {
    py = await load();
  } catch (err) {
    post({ type: 'status', text: '' });
    post({
      type: 'done',
      exitCode: null,
      error: {
        message: `Could not load Python: ${err instanceof Error ? err.message : String(err)}. Check your internet connection (needed the first time only).`,
        line: null,
      },
      trace: null,
      traceTruncated: false,
      ms: 0,
    });
    return;
  }
  post({ type: 'status', text: trace ? 'Tracing…' : 'Running…' });
  let written = 0;
  const emit = (type: 'stdout' | 'stderr') => (text: string) => {
    if (written > MAX_OUTPUT) return;
    written += text.length;
    post({
      type,
      text:
        written > MAX_OUTPUT
          ? `${text}\n… output truncated after ${MAX_OUTPUT} characters.\n`
          : text,
    });
  };
  py.globals.set('_student_code', code);
  py.globals.set('_student_stdin', stdin.endsWith('\n') || stdin === '' ? stdin : `${stdin}\n`);
  py.globals.set('_want_trace', trace);
  py.globals.set('_emit_out', emit('stdout'));
  py.globals.set('_emit_err', emit('stderr'));
  const t0 = performance.now();
  const raw = py.runPython(PYTHON_HARNESS) as string;
  const result = JSON.parse(raw) as {
    exitCode: number;
    error: { message: string; line: number | null } | null;
    trace: TraceStep[] | null;
    truncated: boolean;
  };
  post({ type: 'status', text: '' });
  post({
    type: 'done',
    exitCode: result.exitCode,
    error: result.error,
    trace: result.trace,
    traceTruncated: result.truncated,
    ms: performance.now() - t0,
  });
};
