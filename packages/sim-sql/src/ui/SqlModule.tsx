import { sql, SQLite } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
  Alert,
  Badge,
  Button,
  cx,
  Field,
  Icon,
  ModuleHeader,
  Panel,
  Select,
  tableClass,
  useSharedInput,
  useTheme,
  useWorkerJob,
  type ModuleProps,
} from '@oslab/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  compareResults,
  datasetById,
  DATASETS,
  formatCell,
  lastResultSet,
  type StatementResult,
  type TableInfo,
} from '../engine';
import { DEFAULT_INPUT, sanitizeInput, type SqlInput } from './input';
import type { SqlRequest, SqlResponse } from './sql.worker';

function createSqlWorker() {
  return new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' });
}

function ResultTable({ result }: { result: StatementResult }) {
  return (
    <div className="relative max-h-[420px] overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className={cx(tableClass, 'font-mono text-[0.8rem]')}>
        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
          <tr>
            <th className="w-10 text-right text-slate-400">#</th>
            {result.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => (
            <tr key={r}>
              <td className="text-right text-slate-400">{r + 1}</td>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={cx(
                    'whitespace-nowrap',
                    cell === null && 'italic text-slate-400',
                    typeof cell === 'number' && 'text-right tabular-nums',
                  )}
                >
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatementCard({ result, n }: { result: StatementResult; n: number }) {
  const summary = result.returnsRows
    ? `${result.rows.length}${result.truncated ? '+' : ''} row${result.rows.length === 1 ? '' : 's'}`
    : result.changes > 0
      ? `${result.changes} row${result.changes === 1 ? '' : 's'} changed`
      : 'OK';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge>#{n}</Badge>
        <code className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
          {result.sql.replace(/\s+/g, ' ')}
        </code>
        <span className="font-semibold text-slate-700 dark:text-slate-200">{summary}</span>
      </div>
      {result.returnsRows &&
        (result.rows.length > 0 ? (
          <ResultTable result={result} />
        ) : (
          <p className="text-sm italic text-slate-500">No rows.</p>
        ))}
      {result.truncated && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Only the first {result.rows.length} rows are shown.
        </p>
      )}
    </div>
  );
}

function SchemaPanel({ schema, onPick }: { schema: TableInfo[]; onPick: (table: string) => void }) {
  if (schema.length === 0) {
    return <p className="text-sm text-slate-500">No tables yet. Try CREATE TABLE.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {schema.map((t) => (
        <li key={t.name} className="rounded-md border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => onPick(t.name)}
            className="flex w-full items-center justify-between gap-2 rounded-t-md bg-slate-50 px-2 py-1 text-left text-sm font-semibold hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950"
            title={`Insert SELECT * FROM ${t.name};`}
          >
            <span className="font-mono">{t.name}</span>
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {t.rowCount} row{t.rowCount === 1 ? '' : 's'}
            </span>
          </button>
          <ul className="px-2 py-1 font-mono text-xs">
            {t.columns.map((c) => (
              <li key={c.name} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={cx(c.pk && 'font-bold underline')}>{c.name}</span>
                <span className="text-slate-500 dark:text-slate-400">{c.type.toLowerCase()}</span>
                {c.pk && <span className="text-amber-700 dark:text-amber-300">PK</span>}
                {c.references && (
                  <span className="text-indigo-700 dark:text-indigo-300">→ {c.references}</span>
                )}
                {c.notNull && !c.pk && <span className="text-slate-400">not null</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function SqlModule({ examples }: ModuleProps) {
  const shared = useSharedInput(examples, DEFAULT_INPUT, sanitizeInput);
  const { input, setInput } = shared;
  const { theme } = useTheme();
  const update = (patch: Partial<SqlInput>) => setInput({ ...input, ...patch });
  const dataset = datasetById(input.dataset);
  const job = useWorkerJob<SqlRequest, SqlResponse>(createSqlWorker, {
    timeoutMs: 8000,
    timeoutMessage:
      'The query ran for more than 8 seconds and was stopped. Is there a recursive CTE without a stopping condition, or a huge cross join?',
  });
  const [response, setResponse] = useState<SqlResponse | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  // Only grade after the student presses Run, not on the automatic first run.
  const [graded, setGraded] = useState(false);

  const latest = useRef(input);
  latest.current = input;
  const runJob = job.run;
  const execute = useCallback(
    (byStudent = true) => {
      const current = latest.current;
      setGraded(byStudent);
      runJob(
        {
          datasetSql: datasetById(current.dataset).sql,
          script: current.query,
          solution: current.exercise?.solution ?? null,
        },
        setResponse,
      );
    },
    [runJob],
  );

  // Run once on load and whenever the database or exercise changes, so the schema is always shown.
  useEffect(() => {
    execute(false);
    setShowSolution(false);
  }, [input.dataset, input.exercise, execute]);

  const schema = useMemo(() => response?.schema ?? [], [response]);
  const extensions = useMemo(() => {
    const tables: Record<string, string[]> = {};
    for (const t of schema) tables[t.name] = t.columns.map((c) => c.name);
    return [
      sql({ dialect: SQLite, schema: tables, upperCaseKeywords: true }),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              execute();
              return true;
            },
          },
        ]),
      ),
    ];
  }, [schema, execute]);

  const check = useMemo(() => {
    if (!graded || !response || !input.exercise || !response.expected) return null;
    if (response.run.error) return null;
    return compareResults(lastResultSet(response.run), response.expected, input.exercise.ordered);
  }, [graded, response, input.exercise]);

  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader
        title="SQL playground"
        description="Real SQLite running in your browser. Query sample databases, see every result set, and check exercise answers."
        moduleId="sql"
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

      {input.exercise && (
        <Panel
          title="Exercise"
          actions={
            <>
              <Button onClick={() => setShowSolution((s) => !s)}>
                {showSolution ? 'Hide solution' : 'Show solution'}
              </Button>
              <Button variant="ghost" onClick={() => update({ exercise: null })}>
                <Icon name="close" />
                Close
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="whitespace-pre-line text-slate-800 dark:text-slate-100">
              {input.exercise.prompt}
            </p>
            {input.exercise.ordered && (
              <p className="text-xs text-slate-500">Row order is checked for this exercise.</p>
            )}
            {showSolution && (
              <pre className="overflow-x-auto rounded-md bg-slate-100 p-2 text-sm dark:bg-slate-800">
                {input.exercise.solution}
              </pre>
            )}
            {check && (
              <Alert tone={check.match ? 'success' : 'warning'}>
                {check.match ? <strong>Correct. </strong> : <strong>Not yet. </strong>}
                {check.reason}
              </Alert>
            )}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Query"
            actions={
              <>
                <Field label="Database">
                  <Select
                    value={input.dataset}
                    onChange={(e) => update({ dataset: e.target.value })}
                  >
                    {DATASETS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="primary"
                  onClick={() => execute()}
                  disabled={job.running}
                  title="Run (Ctrl+Enter)"
                  className="self-end"
                >
                  <Icon name="play" />
                  {job.running ? 'Running…' : 'Run'}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <CodeMirror
                value={input.query}
                onChange={(query) => update({ query })}
                extensions={extensions}
                theme={theme === 'dark' ? 'dark' : 'light'}
                basicSetup={{ foldGutter: false }}
                minHeight="200px"
                maxHeight="50vh"
                aria-label="SQL script"
                className="overflow-hidden rounded-md border border-slate-300 text-[0.9rem] dark:border-slate-600"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {dataset.description} Every run starts from a fresh copy, so nothing you change is
                kept. Foreign keys are enforced.
              </p>
            </div>
          </Panel>

          <Panel
            title="Results"
            actions={
              response && (
                <span className="text-xs text-slate-500">
                  {response.run.results.length} statement
                  {response.run.results.length === 1 ? '' : 's'} · {response.ms.toFixed(1)} ms
                </span>
              )
            }
          >
            <div className="flex flex-col gap-4" aria-live="polite">
              {job.error && <Alert tone="error">{job.error}</Alert>}
              {response?.run.results.map((r, i) => (
                <StatementCard key={i} result={r} n={i + 1} />
              ))}
              {response?.run.error && (
                <Alert tone="error">
                  <strong>Error in statement #{response.run.error.index + 1}: </strong>
                  {response.run.error.message}
                  {response.run.error.statement && (
                    <code className="mt-1 block truncate text-xs opacity-80">
                      {response.run.error.statement.replace(/\s+/g, ' ')}
                    </code>
                  )}
                </Alert>
              )}
              {response && response.run.results.length === 0 && !response.run.error && (
                <p className="text-sm text-slate-500">Nothing to run yet.</p>
              )}
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Schema">
            <SchemaPanel
              schema={schema}
              onPick={(table) =>
                update({ query: `${input.query.trimEnd()}\n\nSELECT * FROM ${table};\n` })
              }
            />
          </Panel>
          {dataset.sql && (
            <Panel
              title="How it was created"
              actions={
                <Button variant="ghost" onClick={() => setShowSetup((s) => !s)}>
                  {showSetup ? 'Hide' : 'Show'} SQL
                </Button>
              }
            >
              {showSetup ? (
                <pre className="max-h-[420px] overflow-auto text-xs">{dataset.sql}</pre>
              ) : (
                <p className="text-sm text-slate-500">
                  The CREATE TABLE and INSERT statements behind this database.
                </p>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
