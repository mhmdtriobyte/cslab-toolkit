import { CTraceRecorder, instrument, TraceLimit, type AstNode } from './cTrace';
import {
  MAX_OUTPUT,
  parseClangDiagnostics,
  type RunRequest,
  type TraceStep,
  type WorkerMessage,
} from './protocol';
import { runWasi, Wasi } from './wasi';

/** The `runClang` function of @yowasp/clang (loaded from a CDN in the browser). */
export type RunClang = (
  args: string[],
  files: Record<string, string | Uint8Array>,
  options: {
    stdout?: (b: Uint8Array | null) => void;
    stderr?: (b: Uint8Array | null) => void;
    fetchProgress?: (e: { totalLength: number; doneLength: number }) => void;
  },
) => Promise<Record<string, unknown>>;

const COMMON = [
  '-std=gnu17',
  '-Wall',
  '-Wextra',
  '-Wno-unused-parameter',
  '-fno-color-diagnostics',
];

interface Compiled {
  ok: boolean;
  stdout: string;
  stderr: string;
  files: Record<string, unknown>;
}

async function clang(
  runClang: RunClang,
  args: string[],
  code: string,
  onProgress?: (e: { totalLength: number; doneLength: number }) => void,
): Promise<Compiled> {
  const dec = new TextDecoder();
  let stdout = '';
  let stderr = '';
  try {
    const files = await runClang(
      ['clang', ...args],
      { 'main.c': code },
      {
        stdout: (b) => {
          if (b) stdout += dec.decode(b, { stream: true });
        },
        stderr: (b) => {
          if (b) stderr += dec.decode(b, { stream: true });
        },
        fetchProgress: onProgress,
      },
    );
    return { ok: true, stdout, stderr, files };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === undefined) throw e;
    return { ok: false, stdout, stderr, files: {} };
  }
}

/** Compiles `req.code` with real clang and runs it, streaming messages through `post`. */
export async function runC(
  runClang: RunClang,
  req: RunRequest,
  post: (m: WorkerMessage) => void,
): Promise<void> {
  const t0 = performance.now();
  const done = (
    exitCode: number | null,
    error: { message: string; line: number | null } | null,
    trace: TraceStep[] | null = null,
    traceTruncated = false,
  ) => {
    post({ type: 'status', text: '' });
    post({ type: 'done', exitCode, error, trace, traceTruncated, ms: performance.now() - t0 });
  };

  post({
    type: 'status',
    text: 'Compiling with clang…',
  });
  const progress = (e: { totalLength: number; doneLength: number }) =>
    post({
      type: 'status',
      text: `Downloading the C compiler (about 27 MB, only the first time)… ${Math.round((100 * e.doneLength) / Math.max(1, e.totalLength))}%`,
      progress: e.doneLength / Math.max(1, e.totalLength),
    });

  let wasm: Uint8Array;
  let recorder: CTraceRecorder | null = null;
  let instrumented: ReturnType<typeof instrument> | null = null;

  if (req.trace) {
    // Pass 1: the student's own code, for diagnostics and the AST.
    const ast = await clang(
      runClang,
      [...COMMON, '-fsyntax-only', '-Xclang', '-ast-dump=json', 'main.c'],
      req.code,
      progress,
    );
    post({ type: 'compiler', text: ast.stderr, diagnostics: parseClangDiagnostics(ast.stderr) });
    if (!ast.ok) return done(null, { message: 'Compilation failed.', line: null });
    try {
      instrumented = instrument(req.code, JSON.parse(ast.stdout) as AstNode);
    } catch {
      instrumented = null;
    }
    const built = instrumented
      ? await clang(
          runClang,
          ['-std=gnu17', '-O0', '-w', 'main.c', '-o', 'main.wasm'],
          instrumented.code,
        )
      : null;
    if (!built?.ok || !(built.files['main.wasm'] instanceof Uint8Array)) {
      return done(null, {
        message:
          'This program uses C that the step-through tracer cannot follow yet. Press Run instead.',
        line: null,
      });
    }
    wasm = built.files['main.wasm'];
  } else {
    const built = await clang(
      runClang,
      [...COMMON, '-O1', 'main.c', '-o', 'main.wasm'],
      req.code,
      progress,
    );
    post({
      type: 'compiler',
      text: built.stderr,
      diagnostics: parseClangDiagnostics(built.stderr),
    });
    if (!built.ok || !(built.files['main.wasm'] instanceof Uint8Array)) {
      return done(null, { message: 'Compilation failed.', line: null });
    }
    wasm = built.files['main.wasm'];
  }

  post({ type: 'status', text: req.trace ? 'Tracing…' : 'Running…' });
  let written = 0;
  const out = new TextDecoder();
  const err = new TextDecoder();
  const emit = (type: 'stdout' | 'stderr', dec: TextDecoder) => (bytes: Uint8Array) => {
    if (written > MAX_OUTPUT) return;
    written += bytes.length;
    const text = dec.decode(bytes, { stream: true });
    if (text === '') return;
    post({
      type,
      text:
        written > MAX_OUTPUT ? `${text}\n… output truncated after ${MAX_OUTPUT} bytes.\n` : text,
    });
  };
  let stdoutBytes = 0;
  const stdout = emit('stdout', out);
  const wasi = new Wasi({
    stdin: req.stdin,
    stdout: (b) => {
      stdoutBytes += b.length;
      stdout(b);
    },
    stderr: emit('stderr', err),
  });
  if (instrumented)
    recorder = new CTraceRecorder(
      instrumented,
      () => wasi.memory,
      () => stdoutBytes,
    );
  try {
    const code = await runWasi(wasm, wasi, recorder ? { oslab: recorder.imports() } : {});
    done(code, null, recorder?.finish() ?? null);
  } catch (e) {
    if (e instanceof TraceLimit) return done(null, null, recorder?.finish() ?? null, true);
    const msg = e instanceof Error ? e.message : String(e);
    const trace = recorder?.finish() ?? null;
    const line = trace?.length ? (trace[trace.length - 1] as TraceStep).line : null;
    done(null, {
      message: /out of bounds/i.test(msg)
        ? `Crash: memory access out of bounds (like a segmentation fault). ${msg}`
        : /call stack/i.test(msg)
          ? 'Crash: stack overflow (infinite recursion?).'
          : /unreachable/i.test(msg)
            ? 'Crash: the program aborted (abort(), a failed assert, or undefined behaviour).'
            : `Crash: ${msg}`,
      line,
    });
  }
}
