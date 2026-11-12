import {
  Alert,
  Button,
  cx,
  Field,
  Icon,
  ModuleHeader,
  NumberInput,
  Panel,
  rng,
  Select,
  StepPlayer,
  tableClass,
  Tabs,
  TextInput,
  useSharedInput,
  useStepIndex,
  type ModuleProps,
} from '@oslab/core';
import { useMemo } from 'react';
import {
  parseNumbers,
  searchSteps,
  SORT_ALGORITHMS,
  sortSteps,
  type SearchState,
  type SortState,
} from '../engine';
import { DEFAULT_SORT, sanitizeSort, type SortInput } from './input';
import { Legend } from './TreeView';

function Bars({
  array,
  colorOf,
  dimmed,
}: {
  array: readonly number[];
  colorOf: (i: number) => string;
  dimmed?: (i: number) => boolean;
}) {
  const min = Math.min(0, ...array);
  const max = Math.max(1, ...array);
  return (
    <div
      className="flex h-56 items-end gap-1 overflow-x-auto px-1 pb-1"
      role="img"
      aria-label={`Array: ${array.join(', ')}`}
    >
      {array.map((v, i) => (
        <div
          key={i}
          className={cx(
            'flex min-w-6 flex-1 flex-col items-center justify-end gap-1',
            dimmed?.(i) && 'opacity-30',
          )}
          style={{ height: '100%' }}
        >
          <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {v}
          </span>
          <div
            className={cx('w-full rounded-t transition-all duration-200', colorOf(i))}
            style={{ height: `${8 + ((v - min) / (max - min || 1)) * 80}%` }}
          />
          <span className="text-[10px] tabular-nums text-slate-400">{i}</span>
        </div>
      ))}
    </div>
  );
}

function SortView({
  input,
  update,
}: {
  input: SortInput;
  update: (p: Partial<SortInput>) => void;
}) {
  const values = parseNumbers(input.values);
  const compare = input.algorithm === 'compare';
  const result = useMemo(() => {
    const v = parseNumbers(input.values);
    return v && input.algorithm !== 'compare' ? sortSteps(v, input.algorithm) : null;
  }, [input.values, input.algorithm]);
  const [index, setIndex] = useStepIndex(result);
  const step = result?.steps[Math.min(index, result.steps.length - 1)];
  const s: SortState | undefined = step?.state;
  const info = SORT_ALGORITHMS.find((a) => a.value === input.algorithm);

  const randomize = () => {
    const r = rng(Date.now() % 100000);
    update({ values: Array.from({ length: r.int(8, 14) }, () => r.int(1, 99)).join(' ') });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Input">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Numbers (spaces or commas, up to 40)">
            <TextInput
              value={input.values}
              onChange={(e) => update({ values: e.target.value })}
              className="w-80 max-w-full font-mono"
            />
          </Field>
          <Button onClick={randomize}>
            <Icon name="shuffle" />
            Random
          </Button>
          <Field label="Algorithm">
            <Select
              value={input.algorithm}
              onChange={(e) => update({ algorithm: e.target.value as SortInput['algorithm'] })}
            >
              {SORT_ALGORITHMS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
              <option value="compare">Compare all</option>
            </Select>
          </Field>
          {info && (
            <span className="pb-1.5 text-sm text-slate-500 dark:text-slate-400">
              {info.complexity}
            </span>
          )}
        </div>
      </Panel>
      {!values && <Alert tone="error">Enter 1 to 40 whole numbers, for example 5 3 8 1.</Alert>}
      {values && compare && <CompareTable values={values} />}
      {result && s && step && (
        <>
          <StepPlayer
            count={result.steps.length}
            index={index}
            onIndexChange={setIndex}
            label={step.label}
          />
          <Panel
            title="Array"
            actions={
              <span className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
                Comparisons <strong>{s.comparisons}</strong> ·{' '}
                {input.algorithm === 'merge' ? 'Writes' : 'Swaps'} <strong>{s.moves}</strong>
              </span>
            }
          >
            <Bars
              array={s.array}
              colorOf={(i) =>
                s.pivot === i
                  ? 'bg-indigo-600'
                  : s.moved.includes(i)
                    ? 'bg-rose-500'
                    : s.compare.includes(i)
                      ? 'bg-amber-400'
                      : s.sorted.includes(i)
                        ? 'bg-emerald-500'
                        : 'bg-slate-400 dark:bg-slate-500'
              }
              dimmed={(i) => s.range !== null && (i < s.range[0] || i > s.range[1])}
            />
            <div className="mt-2">
              <Legend
                items={[
                  { className: 'bg-amber-400', label: 'compared' },
                  { className: 'bg-rose-500', label: 'swapped / written' },
                  { className: 'bg-indigo-600', label: 'pivot' },
                  { className: 'bg-emerald-500', label: 'in final place' },
                ]}
              />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function CompareTable({ values }: { values: number[] }) {
  const rows = SORT_ALGORITHMS.map((a) => ({ ...a, ...sortSteps(values, a.value) }));
  const best = Math.min(...rows.map((r) => r.comparisons));
  return (
    <Panel title={`All algorithms on the same ${values.length} numbers`}>
      <div className="relative overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th>Algorithm</th>
              <th className="text-right">Comparisons</th>
              <th className="text-right">Swaps / writes</th>
              <th>Complexity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.value}>
                <td>{r.label}</td>
                <td
                  className={cx(
                    'text-right tabular-nums',
                    r.comparisons === best && 'font-bold text-emerald-700 dark:text-emerald-300',
                  )}
                >
                  {r.comparisons}
                </td>
                <td className="text-right tabular-nums">{r.moves}</td>
                <td className="text-slate-500 dark:text-slate-400">{r.complexity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Try an already sorted list and a reversed one: insertion and bubble sort change the most.
      </p>
    </Panel>
  );
}

function SearchView({
  input,
  update,
}: {
  input: SortInput;
  update: (p: Partial<SortInput>) => void;
}) {
  const values = parseNumbers(input.searchValues);
  const result = useMemo(() => {
    const v = parseNumbers(input.searchValues);
    return v ? searchSteps(v, input.target, input.search) : null;
  }, [input.searchValues, input.target, input.search]);
  const [index, setIndex] = useStepIndex(result);
  const step = result?.steps[Math.min(index, result.steps.length - 1)];
  const s: SearchState | undefined = step?.state;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Input">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Array">
            <TextInput
              value={input.searchValues}
              onChange={(e) => update({ searchValues: e.target.value })}
              className="w-80 max-w-full font-mono"
            />
          </Field>
          <Field label="Target">
            <NumberInput value={input.target} onValueChange={(target) => update({ target })} />
          </Field>
          <Field label="Algorithm">
            <Select
              value={input.search}
              onChange={(e) => update({ search: e.target.value as SortInput['search'] })}
            >
              <option value="binary">Binary search, O(log n)</option>
              <option value="linear">Linear search, O(n)</option>
            </Select>
          </Field>
          {values && (
            <Button
              onClick={() => update({ searchValues: [...values].sort((a, b) => a - b).join(' ') })}
            >
              Sort the array
            </Button>
          )}
        </div>
      </Panel>
      {!values && <Alert tone="error">Enter 1 to 40 whole numbers.</Alert>}
      {result && !result.sortedInput && input.search === 'binary' && (
        <Alert tone="warning">
          The array is not sorted, so binary search can miss values that are there. Press “Sort the
          array”.
        </Alert>
      )}
      {result && s && step && (
        <>
          <StepPlayer
            count={result.steps.length}
            index={index}
            onIndexChange={setIndex}
            label={step.label}
          />
          <Panel
            title="Array"
            actions={
              <span className="text-sm">
                Comparisons <strong>{s.comparisons}</strong>
              </span>
            }
          >
            <div className="flex flex-wrap gap-1.5" role="list">
              {s.array.map((v, i) => (
                <div key={i} role="listitem" className="flex flex-col items-center gap-0.5">
                  <span className="h-4 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                    {[s.lo === i && 'lo', s.mid === i && 'mid', s.hi === i && 'hi']
                      .filter(Boolean)
                      .join(' ')}
                  </span>
                  <span
                    className={cx(
                      'flex h-10 min-w-10 items-center justify-center rounded-md border-2 px-1 font-mono text-sm font-semibold tabular-nums',
                      s.found === i
                        ? 'border-emerald-600 bg-emerald-500 text-white'
                        : s.mid === i
                          ? 'border-amber-500 bg-amber-300 text-slate-900'
                          : s.eliminated.includes(i)
                            ? 'border-slate-200 bg-slate-100 text-slate-400 line-through dark:border-slate-700 dark:bg-slate-800'
                            : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900',
                    )}
                  >
                    {v}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-400">{i}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

export function SortingModule({ examples }: ModuleProps) {
  const shared = useSharedInput(examples, DEFAULT_SORT, sanitizeSort);
  const { input, setInput } = shared;
  const update = (patch: Partial<SortInput>) => setInput({ ...input, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader
        title="Sorting & searching"
        description="Bubble, selection, insertion, merge, quick and heap sort step by step, with comparison counts. Linear and binary search."
        moduleId="sorting"
        examples={examples}
        exampleId={shared.exampleId}
        onLoadExample={shared.loadExample}
        input={input}
        onImport={(raw) => {
          const parsed = sanitizeSort(raw);
          if (parsed) setInput(parsed);
          return parsed !== null;
        }}
      />
      <Tabs
        label="Tool"
        value={input.tab}
        onChange={(tab) => update({ tab })}
        options={[
          { value: 'sort', label: 'Sorting' },
          { value: 'search', label: 'Searching' },
        ]}
      />
      {input.tab === 'sort' ? (
        <SortView input={input} update={update} />
      ) : (
        <SearchView input={input} update={update} />
      )}
    </div>
  );
}
