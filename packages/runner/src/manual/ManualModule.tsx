import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
  cx,
  encodeState,
  Icon,
  Tabs,
  TextInput,
  useSharedInput,
  useTheme,
  type ModuleProps,
} from '@oslab/core';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Language } from '../engine/protocol';
import type { RunnerInput } from '../ui/input';
import { LANGUAGE_NAMES, TOPICS, type Entry, type Topic } from './content';

type View = Language | 'both';

interface ManualInput {
  view: View;
  search: string;
}

const DEFAULT: ManualInput = { view: 'python', search: '' };

function sanitize(raw: unknown): ManualInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    view: r.view === 'c' || r.view === 'both' ? r.view : 'python',
    search: typeof r.search === 'string' ? r.search.slice(0, 60) : '',
  };
}

/** A link that opens the code runner with this example (and its input) loaded. */
export function runnerLink(language: Language, code: string, stdin = ''): string {
  const input: Partial<RunnerInput> =
    language === 'python'
      ? { language, python: code, pythonStdin: stdin }
      : { language, c: code, cStdin: stdin };
  return `/runner#s=${encodeState(input)}`;
}

function CodeBlock({ language, code }: { language: Language; code: string }) {
  const { theme } = useTheme();
  const extensions = useMemo(
    () => [
      language === 'python' ? python() : cpp(),
      EditorView.lineWrapping,
      EditorView.editable.of(false),
    ],
    [language],
  );
  return (
    <CodeMirror
      value={code.trimEnd()}
      extensions={extensions}
      readOnly
      theme={theme === 'dark' ? 'dark' : 'light'}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
      aria-label={`${LANGUAGE_NAMES[language]} example`}
      className="overflow-hidden rounded-md border border-slate-200 text-[0.85rem] dark:border-slate-700"
    />
  );
}

function EntryCard({
  language,
  entry,
  showName,
}: {
  language: Language;
  entry: Entry;
  showName: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {showName && (
        <span className="text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
          {LANGUAGE_NAMES[language]}
        </span>
      )}
      <p className="text-slate-700 dark:text-slate-200">{entry.intro}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
        {entry.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <CodeBlock language={language} code={entry.example.code} />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={runnerLink(language, entry.example.code, entry.example.stdin)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Icon name="play" />
          Run this in the code runner
        </Link>
        {entry.example.stdin && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Input included: <code>{entry.example.stdin.trim().replace(/\n/g, ' ⏎ ')}</code>
          </span>
        )}
      </div>
    </div>
  );
}

function matches(topic: Topic, query: string, languages: Language[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const text = [
    topic.title,
    ...languages.flatMap((l) => [topic[l].intro, ...topic[l].notes, topic[l].example.code]),
  ]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((w) => text.includes(w));
}

export function ManualModule({ examples }: ModuleProps) {
  const shared = useSharedInput(examples, DEFAULT, sanitize);
  const { input, setInput } = shared;
  const languages: Language[] = input.view === 'both' ? ['python', 'c'] : [input.view];
  const topics = TOPICS.filter((t) => matches(t, input.search.trim(), languages));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Manual</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          C and Python syntax by topic, with an example you can run and step through in one click.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          label="Language"
          value={input.view}
          onChange={(view) => setInput({ ...input, view })}
          options={[
            { value: 'python', label: 'Python' },
            { value: 'c', label: 'C' },
            { value: 'both', label: 'Side by side' },
          ]}
        />
        <TextInput
          type="search"
          placeholder="Search: printf, loop, malloc, dict…"
          aria-label="Search the manual"
          value={input.search}
          onChange={(e) => setInput({ ...input, search: e.target.value })}
          className="w-72 max-w-full"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Topics" className="hidden lg:block">
          <ul className="sticky top-16 flex flex-col gap-0.5 text-sm">
            {topics.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .getElementById(`topic-${t.id}`)
                      ?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="block rounded px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  {t.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          {topics.length === 0 && (
            <p className="text-slate-500">Nothing matches “{input.search}”.</p>
          )}
          {topics.map((t) => (
            <section
              key={t.id}
              id={`topic-${t.id}`}
              aria-labelledby={`h-${t.id}`}
              className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <h2
                id={`h-${t.id}`}
                className="mb-3 text-lg font-semibold text-slate-900 dark:text-white"
              >
                {t.title}
              </h2>
              <div className={cx('grid gap-6', input.view === 'both' && 'xl:grid-cols-2')}>
                {languages.map((l) => (
                  <EntryCard key={l} language={l} entry={t[l]} showName={input.view === 'both'} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
