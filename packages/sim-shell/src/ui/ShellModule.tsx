import {
  Alert,
  cx,
  ModuleHeader,
  Panel,
  Select,
  useSharedInput,
  type ModuleProps,
} from '@oslab/core';
import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import {
  complete,
  completedTasks,
  MANUAL,
  missionById,
  MISSIONS,
  startMission,
  type HistoryEntry,
  type Shell,
} from '../engine';
import { Ansi } from './ansi';
import { FilePanel } from './FilePanel';
import { DEFAULT_INPUT, MAX_HISTORY, sanitizeInput, type ShellInput } from './input';

type Line =
  { kind: 'cmd'; prompt: string; text: string } | { kind: 'out' | 'err' | 'info'; text: string };

interface Session {
  mission: string;
  executed: HistoryEntry[];
  shell: Shell;
  lines: Line[];
  done: Set<string>;
}

const MAX_LINES = 2000;

/** Runs one history entry, appending what a real terminal would show. */
function step(s: Session, entry: HistoryEntry): void {
  const mission = missionById(s.mission);
  if (typeof entry === 'string')
    s.lines.push({ kind: 'cmd', prompt: s.shell.prompt(), text: entry });
  const r = s.shell.replay(entry);
  if (s.shell.effects.clear) {
    s.lines = [];
    s.shell.effects.clear = false;
  }
  if (typeof entry !== 'string') {
    s.lines.push(
      r.err ? { kind: 'err', text: r.err } : { kind: 'info', text: `[ Wrote ${entry.path} ]\n` },
    );
  }
  if (typeof entry === 'string') {
    if (r.out) s.lines.push({ kind: 'out', text: r.out });
    if (r.err) s.lines.push({ kind: 'err', text: r.err });
  }
  for (const n of s.shell.takeNotices()) s.lines.push({ kind: 'out', text: `${n}\n` });
  for (const t of completedTasks(mission, s.shell)) s.done.add(t);
  if (s.lines.length > MAX_LINES) s.lines = s.lines.slice(-MAX_LINES);
  s.executed = [...s.executed, entry];
}

function build(input: ShellInput): Session {
  const mission = missionById(input.mission);
  const s: Session = {
    mission: mission.id,
    executed: [],
    shell: startMission(mission),
    lines: [],
    done: new Set(),
  };
  s.lines.push({
    kind: 'info',
    text: `Welcome to CS Lab Linux (simulated). You are "student". Type help for commands, Tab to complete.\n`,
  });
  for (const e of input.history) {
    step(s, e);
    s.shell.effects.editor = null;
  }
  return s;
}

function sameStart(long: HistoryEntry[], short: HistoryEntry[]): boolean {
  return (
    short.length <= long.length &&
    short.every((e, i) => JSON.stringify(e) === JSON.stringify(long[i]))
  );
}

function PromptText({ prompt }: { prompt: string }) {
  const m = /^(\S+@\S+?):(.*?)([$#]) $/.exec(prompt);
  if (!m) return <span>{prompt}</span>;
  return (
    <>
      <span className="font-bold text-emerald-400">{m[1]}</span>:
      <span className="font-bold text-sky-400">{m[2]}</span>
      {m[3]}{' '}
    </>
  );
}

function Editor({
  path,
  content,
  writable,
  onSave,
  onClose,
}: {
  path: string;
  content: string;
  writable: boolean;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(content);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'o')) {
      e.preventDefault();
      if (writable) onSave(text);
    } else if ((e.ctrlKey && e.key === 'x') || e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <div
      className="flex h-full flex-col bg-slate-950 font-mono text-[0.85rem] text-slate-100"
      role="dialog"
      aria-label={`Editing ${path}`}
    >
      <div className="flex items-center justify-between bg-slate-200 px-2 py-0.5 text-slate-900">
        <span>GNU nano (simulated)</span>
        <span className="truncate">{path}</span>
        <span>{writable ? '' : '[ Read-only ]'}</span>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        aria-label="File contents"
        className="min-h-0 flex-1 resize-none bg-transparent p-2 outline-none"
      />
      <div className="flex flex-wrap gap-3 border-t border-slate-700 px-2 py-1 text-xs">
        <button
          type="button"
          disabled={!writable}
          onClick={() => onSave(text)}
          className="disabled:opacity-40"
        >
          <kbd className="bg-slate-200 px-1 text-slate-900">^S</kbd> Save and exit
        </button>
        <button type="button" onClick={onClose}>
          <kbd className="bg-slate-200 px-1 text-slate-900">^X</kbd> Exit without saving
        </button>
        {!writable && (
          <span className="text-rose-300">You do not have write permission for this file.</span>
        )}
      </div>
    </div>
  );
}

export function ShellModule({ examples }: ModuleProps) {
  const shared = useSharedInput(examples, DEFAULT_INPUT, sanitizeInput);
  const { input, setInput } = shared;
  const session = useRef<Session | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [line, setLine] = useState('');
  const [histIndex, setHistIndex] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ path: string; content: string; writable: boolean } | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [treeRoot, setTreeRoot] = useState<'home' | 'root'>('home');
  const [hints, setHints] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the machine in step with the input: replay extra entries, or rebuild after a change of
  // mission, Reset, an imported file or a pasted link.
  const current = session.current;
  if (
    !current ||
    current.mission !== input.mission ||
    !sameStart(input.history, current.executed)
  ) {
    session.current = build(input);
  } else if (input.history.length > current.executed.length) {
    for (const e of input.history.slice(current.executed.length)) step(current, e);
  }
  const s = session.current as Session;
  const mission = missionById(s.mission);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  });

  const commands = s.executed.filter((e): e is string => typeof e === 'string');

  const record = (entry: HistoryEntry) => {
    step(s, entry);
    if (s.executed.length <= MAX_HISTORY) setInput({ ...input, history: s.executed });
    else if (s.executed.length === MAX_HISTORY + 1) {
      s.lines.push({
        kind: 'info',
        text: `(Share links keep the first ${MAX_HISTORY} commands only.)\n`,
      });
    }
    rerender();
  };

  const submit = () => {
    let text = line;
    // History expansion: !! and !n.
    const bang = /^!(!|\d+)$/.exec(text.trim());
    if (bang) {
      const cmd = bang[1] === '!' ? commands[commands.length - 1] : commands[Number(bang[1]) - 1];
      if (!cmd) {
        s.lines.push(
          { kind: 'cmd', prompt: s.shell.prompt(), text },
          { kind: 'err', text: `bash: ${text.trim()}: event not found\n` },
        );
        setLine('');
        rerender();
        return;
      }
      text = cmd;
    }
    setLine('');
    setHistIndex(null);
    if (text.trim() === '') {
      s.lines.push({ kind: 'cmd', prompt: s.shell.prompt(), text: '' });
      rerender();
      return;
    }
    record(text);
    if (s.shell.effects.editor) {
      setEditor(s.shell.effects.editor);
      s.shell.effects.editor = null;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (commands.length === 0) return;
      const next =
        e.key === 'ArrowUp'
          ? Math.max(0, (histIndex ?? commands.length) - 1)
          : histIndex === null
            ? null
            : histIndex + 1 >= commands.length
              ? null
              : histIndex + 1;
      setHistIndex(next);
      setLine(next === null ? '' : (commands[next] as string));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const c = complete(s.shell, line);
      if (c.options.length > 0) {
        s.lines.push(
          { kind: 'cmd', prompt: s.shell.prompt(), text: line },
          { kind: 'out', text: `${c.options.join('  ')}\n` },
        );
        rerender();
      }
      setLine(c.line);
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      s.lines = [];
      rerender();
    } else if (e.ctrlKey && e.key === 'c') {
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      s.lines.push({ kind: 'cmd', prompt: s.shell.prompt(), text: `${line}^C` });
      setLine('');
      rerender();
    }
  };

  const allDone = mission.tasks.length > 0 && mission.tasks.every((t) => s.done.has(t.id));
  const treePath = treeRoot === 'home' ? '/home/student' : '/';

  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader
        title="Linux terminal"
        description="A simulated Linux shell for practising commands, permissions, pipes, processes and scripts. Nothing you type can harm your computer."
        moduleId="shell"
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section
          className="flex h-[560px] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-sm"
          aria-label="Terminal"
        >
          <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400">
            <span className="flex gap-1.5" aria-hidden>
              <span className="h-3 w-3 rounded-full bg-rose-500/80" />
              <span className="h-3 w-3 rounded-full bg-amber-400/80" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
            </span>
            <span className="flex-1 text-center font-mono">
              {s.shell.prompt().trim().replace(/[$#]$/, '')}
            </span>
            <button
              type="button"
              onClick={() => setInput({ ...input, history: [] })}
              className="rounded px-1.5 py-0.5 hover:bg-slate-800 hover:text-white"
              title="Start this mission over with a fresh machine"
            >
              Reset
            </button>
          </div>
          {editor ? (
            <Editor
              key={editor.path}
              {...editor}
              onClose={() => {
                setEditor(null);
                window.setTimeout(() => inputRef.current?.focus());
              }}
              onSave={(content) => {
                setEditor(null);
                record({ path: editor.path, content });
                window.setTimeout(() => inputRef.current?.focus());
              }}
            />
          ) : (
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 cursor-text overflow-auto p-3 font-mono text-[0.85rem] leading-relaxed text-slate-100"
              onClick={() => {
                if (!window.getSelection()?.toString()) inputRef.current?.focus();
              }}
              role="log"
              aria-live="polite"
            >
              {s.lines.map((l, i) =>
                l.kind === 'cmd' ? (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    <PromptText prompt={l.prompt} />
                    {l.text}
                  </div>
                ) : (
                  <div
                    key={i}
                    className={cx(
                      'whitespace-pre-wrap break-all',
                      l.kind === 'err' && 'text-rose-300',
                      l.kind === 'info' && 'text-slate-400 italic',
                    )}
                  >
                    <Ansi text={l.text.replace(/\n$/, '')} />
                  </div>
                ),
              )}
              <div className="flex whitespace-pre">
                <PromptText prompt={s.shell.prompt()} />
                <input
                  ref={inputRef}
                  value={line}
                  onChange={(e) => {
                    setLine(e.target.value);
                    setHistIndex(null);
                  }}
                  onKeyDown={onKeyDown}
                  autoFocus
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Command"
                  className="min-w-0 flex-1 bg-transparent text-slate-100 caret-emerald-400 outline-none"
                />
              </div>
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Mission"
            actions={
              <Select
                aria-label="Choose a mission"
                value={mission.id}
                onChange={(e) => setInput({ mission: e.target.value, history: [] })}
              >
                {MISSIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </Select>
            }
          >
            <div className="flex flex-col gap-2">
              <p className="text-sm text-slate-600 dark:text-slate-300">{mission.intro}</p>
              {mission.tasks.length > 0 && (
                <p className="text-xs font-semibold text-slate-500">
                  {s.done.size} / {mission.tasks.length} done
                </p>
              )}
              <ol className="flex flex-col gap-1.5">
                {mission.tasks.map((t) => {
                  const done = s.done.has(t.id);
                  return (
                    <li key={t.id} className="flex gap-2 text-sm">
                      <span
                        className={cx(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                          done
                            ? 'border-emerald-600 bg-emerald-500 text-white'
                            : 'border-slate-300 dark:border-slate-600',
                        )}
                        aria-label={done ? 'done' : 'not done'}
                      >
                        {done ? '✓' : ''}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span
                          className={cx(done && 'text-slate-500 line-through dark:text-slate-400')}
                        >
                          {t.text}
                        </span>
                        {!done &&
                          (hints.has(t.id) ? (
                            <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">
                              {t.hint}
                            </pre>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setHints(new Set([...hints, t.id]))}
                              className="ml-2 text-xs text-indigo-700 underline dark:text-indigo-300"
                            >
                              hint
                            </button>
                          ))}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {allDone && (
                <Alert tone="success">Mission complete. Pick the next one from the list.</Alert>
              )}
            </div>
          </Panel>

          <Panel
            title="Files"
            actions={
              <Select
                aria-label="Tree root"
                value={treeRoot}
                onChange={(e) => setTreeRoot(e.target.value as 'home' | 'root')}
              >
                <option value="home">Home folder</option>
                <option value="root">Whole system</option>
              </Select>
            }
          >
            <FilePanel shell={s.shell} root={treePath} selected={selected} onSelect={setSelected} />
          </Panel>

          <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <summary className="cursor-pointer font-semibold">Cheat sheet</summary>
            <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-auto">
              {Object.entries(MANUAL).map(([cmd, text]) => (
                <li key={cmd}>
                  <button
                    type="button"
                    className="w-full text-left hover:text-indigo-700 dark:hover:text-indigo-300"
                    onClick={() => {
                      setLine(`${cmd} `);
                      inputRef.current?.focus();
                    }}
                    title="Put this command in the terminal"
                  >
                    <code className="font-semibold">{cmd}</code>{' '}
                    <span className="text-slate-600 dark:text-slate-400">
                      {text.replace(/^\S+\s/, '')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
