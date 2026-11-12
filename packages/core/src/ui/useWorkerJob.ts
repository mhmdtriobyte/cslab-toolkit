import { useCallback, useEffect, useRef, useState } from 'react';

export interface WorkerJobOptions {
  /** Stop the worker and report `timeoutMessage` if it has not answered by then. */
  timeoutMs?: number;
  timeoutMessage?: string;
}

/**
 * Runs one request at a time in a fresh Web Worker, so a long search never freezes the page.
 * `create` must return a new worker each call; starting a new job or unmounting stops the old one.
 */
export function useWorkerJob<Req, Res>(create: () => Worker, options: WorkerJobOptions = {}) {
  const worker = useRef<Worker | null>(null);
  const timer = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { timeoutMs, timeoutMessage } = options;

  const cancel = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    (request: Req, onDone: (result: Res) => void) => {
      cancel();
      const w = create();
      worker.current = w;
      setRunning(true);
      setError(null);
      w.onmessage = (e: MessageEvent<Res>) => {
        cancel();
        onDone(e.data);
      };
      w.onerror = (e) => {
        cancel();
        setError(e.message || 'The search failed.');
      };
      if (timeoutMs !== undefined) {
        timer.current = window.setTimeout(() => {
          cancel();
          setError(timeoutMessage ?? `Stopped after ${timeoutMs / 1000} s.`);
        }, timeoutMs);
      }
      w.postMessage(request);
    },
    [cancel, create, timeoutMs, timeoutMessage],
  );

  return { run, cancel, running, error };
}
