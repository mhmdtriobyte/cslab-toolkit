import {
  Alert,
  Badge,
  Button,
  cx,
  Icon,
  ModuleHeader,
  Panel,
  StepPlayer,
  tableClass,
  Tabs,
  useSharedInput,
  useStepIndex,
  type ModuleProps,
} from '@oslab/core';
import { useCallback, useMemo } from 'react';
import type { Frame, Language, TraceStep } from '../engine/protocol';
import { Editor } from './Editor';
import { DEFAULT_INPUT, sanitizeInput, type RunnerInput } from './input';
import { useRunner, type OutputChunk } from './useRunner';

const LANGS: { value: Language; label: string }[] = [
  { value: 'python', label: 'Python 3.14' },
  { value: 'c', label: 'C (clang 22)' },
];

function Terminal({ chunks, empty }: { chunks: OutputChunk[]; empty: string }) {
  return (
    <pre
      className="max-h-[50vh] min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 font-mono text-[0.85rem] text-slate-100"
      aria-live="polite"
      aria-label="Program output"
    >
      {chunks.length === 0 ? (
        <span className="text-slate-500">{empty}</span>
      ) : (
        chunks.map((c, i) => (
          <span key={i} className={c.stream === 'stderr' ? 'text-rose-300' : undefined}>
            {c.text}
          </span>
        ))
      )}
    </pre>
  );
}

function FrameCard({ frame, prev, top }: { frame: Frame; prev: Frame | undefined; top: boolean }) {
  const before = new Map(prev?.vars.map((v) => [v.name, v.value]));
  return (
    <div
      className={cx(
        'rounded-md border',
        top ? 'border-indigo-400 dark:border-indigo-500' : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <div
        className={cx(
          'flex items-center justify-between rounded-t-md px-2 py-1 text-sm font-semibold',
          top ? 'bg-indigo-50 dark:bg-indigo-950' : 'bg-slate-50 dark:bg-slate-800',
        )}
      >
        <span className="font-mono">{frame.func === 'global' ? 'Globals' : `${frame.func}()`}</span>
        {frame.func !== 'global' && frame.line > 0 && (
          <span className="text-xs font-normal text-slate-500">line {frame.line}</span>
        )}
      </div>
      {frame.vars.length === 0 ? (
        <p className="px-2 py-1 text-xs italic text-slate-500">no variables yet</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className={cx(tableClass, 'font-mono text-[0.8rem]')}>
            <tbody>
              {frame.vars.map((v) => {
                const changed = prev !== undefined && before.get(v.name) !== v.value;
                return (
                  <tr key={v.name}>
                    <td className="w-0 whitespace-nowrap font-semibold">{v.name}</td>
                    <td className="w-0 whitespace-nowrap text-xs text-slate-500">{v.type}</td>
                    <td
                      className={cx(
                        'break-all',
                        changed && 'bg-amber-100 font-semibold dark:bg-amber-900/60',
                      )}
                    >
                      {v.value}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TraceView({
  trace,
  index,
  setIndex,
  stdout,
  truncated,
}: {
  trace: TraceStep[];
  index: number;
  setIndex: (i: number) => void;
  stdout: string;
  truncated: boolean;
}) {
  const step = trace[Math.min(index, trace.length - 1)] as TraceStep;
  const prevStep = index > 0 ? trace[index - 1] : undefined;
  const label =
    step.event === 'call'
      ? `Line ${step.line}: call ${step.stack[step.stack.length - 1]?.func}()`
      : step.event === 'return'
        ? `Line ${step.line}: ${step.stack[step.stack.length - 1]?.func === 'global' ? 'program ends' : `return ${step.detail}`}`
        : step.event === 'exception'
          ? `Line ${step.line}: ${step.detail}`
          : `About to run line ${step.line}`;
  return (
    <div className="flex flex-col gap-3">
      <StepPlayer count={trace.length} index={index} onIndexChange={setIndex} label={label} />
      {truncated && (
        <Alert tone="warning">
          The trace stopped after {trace.length} steps (an infinite loop?). Press Run to run the
          program without tracing.
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Variables (call stack, newest last)</h3>
          {step.stack.map((f, i) => (
            <FrameCard
              key={`${i}-${f.func}`}
              frame={f}
              prev={prevStep?.stack[i]?.func === f.func ? prevStep.stack[i] : undefined}
              top={i === step.stack.length - 1}
            />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Output so far</h3>
          <Terminal
            chunks={
              step.stdoutLength > 0
                ? [{ stream: 'stdout', text: stdout.slice(0, step.stdoutLength) }]
                : []
            }
            empty="(nothing printed yet)"
          />
        </div>
      </div>
    </div>
  );
}

export function RunnerModule({ examples }: ModuleProps) {
  const shared = useSharedInput(examples, DEFAULT_INPUT, sanitizeInput);
  const { input, setInput } = shared;
  const update = (patch: Partial<RunnerInput>) => setInput({ ...input, ...patch });
  const { state, run, stop } = useRunner();
  const language = input.language;
  const code = language === 'python' ? input.python : input.c;
  const stdin = language === 'python' ? input.pythonStdin : input.cStdin;
  const sameLanguage = state.language === language;
  const trace = sameLanguage ? state.trace : null;
  const [index, setIndex] = useStepIndex(trace);

  const start = useCallback(
    (wantTrace: boolean) => run(language, { code, stdin, trace: wantTrace }),
    [run, language, code, stdin],
  );
  const runNow = useCallback(() => start(false), [start]);

  const stdoutText = useMemo(
    () =>
      state.output
        .filter((c) => c.stream === 'stdout')
        .map((c) => c.text)
        .join(''),
    [state.output],
  );
  const result = sameLanguage ? state.result : null;
  const diagnostics = sameLanguage && language === 'c' ? (state.compiler?.diagnostics ?? []) : [];
  const currentLine =
    trace && trace.length ? (trace[Math.min(index, trace.length - 1)]?.line ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader
        title="Code runner"
        description={
          <>
            Real Python and real C, compiled and run in your browser. <strong>Step through</strong>{' '}
            shows every line with the variables of each function call.
          </>
        }
        moduleId="runner"
        examples={examples}
        exampleId={shared.exampleId}
        onLoadExample={shared.loadExample}
        input={input}
        onImport={(raw) => {
          const parsed = sanitizeInput(raw);
          if (parsed) setInput(parsed);
          return parsed !== null;
        }}
      />
      <Tabs
        label="Language"
        value={language}
        onChange={(l) => update({ language: l })}
        options={LANGS}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={language === 'python' ? 'main.py' : 'main.c'}
            actions={
              <>
                {state.running ? (
                  <Button variant="danger" onClick={() => stop()}>
                    <Icon name="close" />
                    Stop
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" onClick={runNow} title="Run (Ctrl+Enter)">
                      <Icon name="play" />
                      Run
                    </Button>
                    <Button
                      onClick={() => start(true)}
                      title="Run line by line and record every step"
                    >
                      <Icon name="next" />
                      Step through
                    </Button>
                  </>
                )}
              </>
            }
          >
            <Editor
              language={language}
              value={code}
              onChange={(v) => update(language === 'python' ? { python: v } : { c: v })}
              currentLine={currentLine}
              errorLine={result?.error?.line ?? null}
              diagnostics={diagnostics}
              onRun={runNow}
            />
          </Panel>
          <Panel title="Input (what the program reads with input() or scanf)">
            <textarea
              value={stdin}
              onChange={(e) =>
                update(
                  language === 'python'
                    ? { pythonStdin: e.target.value }
                    : { cStdin: e.target.value },
                )
              }
              rows={3}
              spellCheck={false}
              aria-label="Standard input"
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {state.running && state.status && sameLanguage && (
            <div className="flex flex-col gap-1.5" role="status">
              <p className="text-sm text-slate-700 dark:text-slate-200">{state.status}</p>
              <div className="h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                <div
                  className={cx(
                    'h-full bg-indigo-600 transition-all',
                    state.progress === null && 'w-1/3 animate-pulse',
                  )}
                  style={
                    state.progress !== null
                      ? { width: `${Math.round(state.progress * 100)}%` }
                      : undefined
                  }
                />
              </div>
            </div>
          )}
          {sameLanguage && state.compiler && state.compiler.text.trim() && (
            <Panel
              title="Compiler messages"
              actions={
                <span className="flex gap-1">
                  {(['error', 'warning'] as const).map((sev) => {
                    const n =
                      state.compiler?.diagnostics.filter((d) => d.severity === sev).length ?? 0;
                    return n ? (
                      <Badge
                        key={sev}
                        className={
                          sev === 'error'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100'
                            : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
                        }
                      >
                        {n} {sev}
                        {n === 1 ? '' : 's'}
                      </Badge>
                    ) : null;
                  })}
                </span>
              }
            >
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">
                {state.compiler.text}
              </pre>
            </Panel>
          )}
          {trace && trace.length > 0 ? (
            <Panel title="Step through">
              <TraceView
                trace={trace}
                index={index}
                setIndex={setIndex}
                stdout={stdoutText}
                truncated={result?.traceTruncated ?? false}
              />
            </Panel>
          ) : null}
          <Panel
            title="Output"
            actions={
              result && (
                <span className="text-xs text-slate-500">
                  {result.exitCode !== null && `exit code ${result.exitCode} · `}
                  {result.ms.toFixed(0)} ms
                </span>
              )
            }
          >
            <div className="flex flex-col gap-2">
              <Terminal
                chunks={sameLanguage ? state.output : []}
                empty={state.running ? '' : 'Press Run (Ctrl+Enter) to see the output here.'}
              />
              {result?.error &&
                result.error.message !== 'Compilation failed.' &&
                language === 'c' && <Alert tone="error">{result.error.message}</Alert>}
              {result?.error && result.error.message === 'Compilation failed.' && (
                <Alert tone="error">The program did not compile: see the compiler messages.</Alert>
              )}
              {result?.error && language === 'python' && result.error.line === null && (
                <Alert tone="error">{result.error.message}</Alert>
              )}
            </div>
          </Panel>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The first run loads the real{' '}
            {language === 'python'
              ? 'Python interpreter (about 12 MB)'
              : 'clang compiler (about 105 MB, 27 MB when compressed)'}{' '}
            from this site; after that it is cached and works offline. Programs cannot read files or
            use the network, and they stop after 10 seconds.{' '}
            {language === 'c' &&
              'fork() and exec() need a real OS: use the Fork visualizer for those.'}
          </p>
        </div>
      </div>
    </div>
  );
}
