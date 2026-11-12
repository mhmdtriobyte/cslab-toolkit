/** Messages between the runner UI and its language workers. */

export type Language = 'python' | 'c';

export interface RunRequest {
  code: string;
  /** Everything the program can read from standard input. */
  stdin: string;
  /** Record a line-by-line trace instead of only running (Python, and C via instrumentation). */
  trace: boolean;
}

export interface Variable {
  name: string;
  /** Short printable value, like Python's repr() or C's printf. */
  value: string;
  type: string;
}

export interface Frame {
  func: string;
  line: number;
  vars: Variable[];
}

export interface TraceStep {
  line: number;
  event: 'line' | 'call' | 'return' | 'exception';
  /** Outermost first. */
  stack: Frame[];
  /** Length of stdout at this point, to show the output so far. */
  stdoutLength: number;
  /** Value returned (return events) or exception text. */
  detail?: string;
}

export interface Diagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export type WorkerMessage =
  | { type: 'status'; text: string; progress?: number }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'compiler'; text: string; diagnostics: Diagnostic[] }
  | {
      type: 'done';
      exitCode: number | null;
      /** Uncaught exception / runtime error, with the line when known. */
      error: { message: string; line: number | null } | null;
      trace: TraceStep[] | null;
      traceTruncated: boolean;
      ms: number;
    };

/** Parses clang's "main.c:12:5: error: message" lines. */
export function parseClangDiagnostics(stderr: string, file = 'main.c'): Diagnostic[] {
  const out: Diagnostic[] = [];
  const re = new RegExp(
    `^${file.replace('.', '\\.')}:(\\d+):(\\d+): (error|warning|note): (.*)$`,
    'gm',
  );
  for (const m of stderr.matchAll(re)) {
    out.push({
      line: Number(m[1]),
      column: Number(m[2]),
      severity: m[3] as Diagnostic['severity'],
      message: m[4] as string,
    });
  }
  return out;
}

export const MAX_OUTPUT = 200_000;
export const MAX_TRACE_STEPS = 2000;
