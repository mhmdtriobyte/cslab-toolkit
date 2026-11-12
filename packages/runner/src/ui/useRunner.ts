import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Diagnostic,
  Language,
  RunRequest,
  TraceStep,
  WorkerMessage,
} from '../engine/protocol';

export interface OutputChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface RunState {
  running: boolean;
  status: string;
  progress: number | null;
  output: OutputChunk[];
  compiler: { text: string; diagnostics: Diagnostic[] } | null;
  result: Extract<WorkerMessage, { type: 'done' }> | null;
  /** Set when the run was a trace. */
  trace: TraceStep[] | null;
  /** Which language produced this state. */
  language: Language | null;
}

const EMPTY: RunState = {
  running: false,
  status: '',
  progress: null,
  output: [],
  compiler: null,
  result: null,
  trace: null,
  language: null,
};

/** Wall-clock limits once the program itself starts (downloads and compiling do not count). */
const RUN_LIMIT_MS = 10_000;
const TRACE_LIMIT_MS = 20_000;

function createWorker(language: Language): Worker {
  return language === 'python'
    ? new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./c.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * One long-lived worker per language, so Python and the C compiler stay loaded between runs.
 * Stop (or the time limit) terminates the worker; the next run starts a fresh one.
 */
export function useRunner() {
  const workers = useRef<Partial<Record<Language, Worker>>>({});
  const timer = useRef<number | null>(null);
  const active = useRef<Language | null>(null);
  const [state, setState] = useState<RunState>(EMPTY);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const kill = useCallback((language: Language) => {
    workers.current[language]?.terminate();
    delete workers.current[language];
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      for (const w of Object.values(workers.current)) w?.terminate();
    },
    [],
  );

  const stop = useCallback(
    (reason = 'Stopped.') => {
      const language = active.current;
      clearTimer();
      if (language) kill(language);
      active.current = null;
      setState((s) =>
        s.running
          ? {
              ...s,
              running: false,
              status: '',
              progress: null,
              output: [...s.output, { stream: 'stderr', text: `\n${reason}\n` }],
            }
          : s,
      );
    },
    [kill],
  );

  const run = useCallback(
    (language: Language, request: RunRequest) => {
      if (active.current) stop();
      let w = workers.current[language];
      if (!w) {
        w = createWorker(language);
        workers.current[language] = w;
      }
      active.current = language;
      setState({ ...EMPTY, running: true, status: 'Starting…', language });
      w.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'status') {
          if (/^(Running|Tracing)/.test(m.text) && timer.current === null) {
            const limit = request.trace ? TRACE_LIMIT_MS : RUN_LIMIT_MS;
            timer.current = window.setTimeout(
              () =>
                stop(
                  `Stopped after ${limit / 1000} seconds. Is there an infinite loop, or is the program waiting for more input?`,
                ),
              limit,
            );
          }
          setState((s) => ({ ...s, status: m.text, progress: m.progress ?? null }));
        } else if (m.type === 'stdout' || m.type === 'stderr') {
          const chunk = { stream: m.type, text: m.text };
          setState((s) => {
            const lastChunk = s.output[s.output.length - 1];
            const output =
              lastChunk && lastChunk.stream === chunk.stream
                ? [...s.output.slice(0, -1), { ...lastChunk, text: lastChunk.text + chunk.text }]
                : [...s.output, chunk];
            return { ...s, output };
          });
        } else if (m.type === 'compiler') {
          setState((s) => ({ ...s, compiler: { text: m.text, diagnostics: m.diagnostics } }));
        } else {
          clearTimer();
          active.current = null;
          setState((s) => ({
            ...s,
            running: false,
            status: '',
            progress: null,
            result: m,
            trace: m.trace,
          }));
        }
      };
      w.onerror = (e) => {
        clearTimer();
        kill(language);
        active.current = null;
        setState((s) => ({
          ...s,
          running: false,
          status: '',
          output: [
            ...s.output,
            { stream: 'stderr', text: `\n${e.message || 'The runner crashed.'}\n` },
          ],
        }));
      };
      w.postMessage(request);
    },
    [kill, stop],
  );

  const reset = useCallback(() => setState(EMPTY), []);

  return { state, run, stop, reset };
}
