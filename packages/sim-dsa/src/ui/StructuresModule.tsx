import {
  Alert,
  cx,
  Field,
  ModuleHeader,
  NumberInput,
  Panel,
  Select,
  StepPlayer,
  Tabs,
  useSharedInput,
  useStepIndex,
  type ModuleProps,
} from '@oslab/core';
import { useMemo, type ReactNode } from 'react';
import {
  HASH_METHODS,
  hashSteps,
  heapSteps,
  parseHashOps,
  parseHeapOps,
  parseTreeOps,
  secondHash,
  treeHeight,
  treeSize,
  treeSteps,
  type HashMethod,
  type TreeNode,
} from '../engine';
import { DEFAULT_STRUCT, sanitizeStruct, type StructInput } from './input';
import { Legend, TreeView, type DrawNode } from './TreeView';

function OpsEditor({
  value,
  onChange,
  help,
}: {
  value: string;
  onChange: (v: string) => void;
  help: ReactNode;
}) {
  return (
    <Field label="Operations (one per line or separated by ;)">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        spellCheck={false}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      <span className="font-normal text-slate-500 dark:text-slate-400">{help}</span>
    </Field>
  );
}

function toDraw(n: TreeNode | null, avl: boolean): DrawNode | null {
  if (!n) return null;
  const bf = (n.left?.height ?? 0) - (n.right?.height ?? 0);
  return {
    id: n.id,
    label: String(n.key),
    left: toDraw(n.left, avl),
    right: toDraw(n.right, avl),
    note: avl ? `bf ${bf > 0 ? '+' : ''}${bf}` : undefined,
  };
}

function TreeTab({
  input,
  update,
}: {
  input: StructInput;
  update: (p: Partial<StructInput>) => void;
}) {
  const ops = useMemo(() => parseTreeOps(input.treeOps), [input.treeOps]);
  const steps = useMemo(
    () => (typeof ops === 'string' ? null : treeSteps(ops, input.treeKind)),
    [ops, input.treeKind],
  );
  const [index, setIndex] = useStepIndex(steps, steps ? steps.length - 1 : 0);
  const step = steps?.[Math.min(index, steps.length - 1)];
  const s = step?.state;
  const visitedIds = useMemo(() => {
    if (!s) return [];
    const ids: number[] = [];
    const want = new Map<number, number>();
    for (const k of s.visited) want.set(k, (want.get(k) ?? 0) + 1);
    const walk = (n: TreeNode | null) => {
      if (!n) return;
      if (want.get(n.key)) ids.push(n.id);
      walk(n.left);
      walk(n.right);
    };
    walk(s.root);
    return ids;
  }, [s]);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Input">
        <div className="flex flex-col gap-3">
          <Field label="Tree">
            <Select
              value={input.treeKind}
              onChange={(e) => update({ treeKind: e.target.value as StructInput['treeKind'] })}
              className="w-72"
            >
              <option value="bst">Binary search tree</option>
              <option value="avl">AVL tree (self-balancing)</option>
            </Select>
          </Field>
          <OpsEditor
            value={input.treeOps}
            onChange={(treeOps) => update({ treeOps })}
            help={
              <>
                <code>insert 5 3 8</code>, <code>delete 3</code>, <code>search 8</code>, and{' '}
                <code>inorder</code> / <code>preorder</code> / <code>postorder</code> /{' '}
                <code>levelorder</code>.
              </>
            }
          />
        </div>
      </Panel>
      {typeof ops === 'string' && <Alert tone="error">{ops}</Alert>}
      {steps && s && step && (
        <>
          <StepPlayer
            count={steps.length}
            index={index}
            onIndexChange={setIndex}
            label={step.label}
          />
          <Panel
            title={input.treeKind === 'avl' ? 'AVL tree' : 'Binary search tree'}
            actions={
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {treeSize(s.root)} nodes · height {treeHeight(s.root)}
              </span>
            }
          >
            <TreeView
              root={toDraw(s.root, input.treeKind === 'avl')}
              path={s.path}
              focus={s.focus}
              changed={s.changed}
              visited={visitedIds}
            />
            {s.visited.length > 0 && (
              <p className="mt-2 font-mono text-sm">
                Output: <strong>{s.visited.join(' ')}</strong>
              </p>
            )}
            <div className="mt-2">
              <Legend
                items={[
                  { className: 'bg-amber-400', label: 'path walked' },
                  { className: 'bg-indigo-600', label: 'current node' },
                  { className: 'bg-rose-500', label: 'changed / rotated' },
                  { className: 'bg-emerald-500', label: 'visited by traversal' },
                ]}
              />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function heapToDraw(heap: readonly number[], i = 0): DrawNode | null {
  if (i >= heap.length) return null;
  return {
    id: i,
    label: String(heap[i]),
    left: heapToDraw(heap, 2 * i + 1),
    right: heapToDraw(heap, 2 * i + 2),
    note: `[${i}]`,
  };
}

function HeapTab({
  input,
  update,
}: {
  input: StructInput;
  update: (p: Partial<StructInput>) => void;
}) {
  const ops = useMemo(() => parseHeapOps(input.heapOps), [input.heapOps]);
  const steps = useMemo(
    () => (typeof ops === 'string' ? null : heapSteps(ops, input.heapKind)),
    [ops, input.heapKind],
  );
  const [index, setIndex] = useStepIndex(steps, steps ? steps.length - 1 : 0);
  const step = steps?.[Math.min(index, steps.length - 1)];
  const s = step?.state;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Input">
        <div className="flex flex-col gap-3">
          <Field label="Heap">
            <Select
              value={input.heapKind}
              onChange={(e) => update({ heapKind: e.target.value as StructInput['heapKind'] })}
              className="w-72"
            >
              <option value="min">Min-heap (smallest on top)</option>
              <option value="max">Max-heap (largest on top)</option>
            </Select>
          </Field>
          <OpsEditor
            value={input.heapOps}
            onChange={(heapOps) => update({ heapOps })}
            help={
              <>
                <code>insert 5 3 8</code> and <code>extract</code> (or <code>extract 3</code> to
                remove the top three times).
              </>
            }
          />
        </div>
      </Panel>
      {typeof ops === 'string' && <Alert tone="error">{ops}</Alert>}
      {steps && s && step && (
        <>
          <StepPlayer
            count={steps.length}
            index={index}
            onIndexChange={setIndex}
            label={step.label}
          />
          <Panel title="As a tree">
            <TreeView
              root={heapToDraw(s.heap)}
              changed={s.swapped ? s.active : []}
              path={s.swapped ? [] : s.active}
              emptyText="Empty heap."
            />
          </Panel>
          <Panel title="As an array (how it is stored)">
            <div className="flex flex-wrap gap-1">
              {s.heap.map((v, i) => (
                <div key={i} className="flex flex-col items-center">
                  <span
                    className={cx(
                      'flex h-10 min-w-10 items-center justify-center rounded-md border-2 px-1 font-mono text-sm font-semibold',
                      s.active.includes(i)
                        ? s.swapped
                          ? 'border-rose-600 bg-rose-500 text-white'
                          : 'border-amber-500 bg-amber-300 text-slate-900'
                        : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900',
                    )}
                  >
                    {v}
                  </span>
                  <span className="text-[10px] text-slate-400">{i}</span>
                </div>
              ))}
              {s.heap.length === 0 && <span className="text-sm text-slate-500">(empty)</span>}
            </div>
            {s.extracted.length > 0 && (
              <p className="mt-3 font-mono text-sm">
                Extracted so far: <strong>{s.extracted.join(' ')}</strong>
              </p>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function HashTab({
  input,
  update,
}: {
  input: StructInput;
  update: (p: Partial<StructInput>) => void;
}) {
  const ops = useMemo(() => parseHashOps(input.hashOps), [input.hashOps]);
  const steps = useMemo(
    () => (typeof ops === 'string' ? null : hashSteps(ops, input.hashSize, input.hashMethod)),
    [ops, input.hashSize, input.hashMethod],
  );
  const [index, setIndex] = useStepIndex(steps, steps ? steps.length - 1 : 0);
  const step = steps?.[Math.min(index, steps.length - 1)];
  const s = step?.state;
  // secondHash(0, m) = R, the prime used by h₂.
  const R = secondHash(0, input.hashSize);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Input">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Collision handling">
              <Select
                value={input.hashMethod}
                onChange={(e) => update({ hashMethod: e.target.value as HashMethod })}
              >
                {HASH_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Table size m">
              <NumberInput
                value={input.hashSize}
                min={2}
                max={31}
                onValueChange={(hashSize) => update({ hashSize })}
              />
            </Field>
            {input.hashMethod === 'double' && (
              <span className="pb-1.5 text-sm text-slate-500">
                step h₂(k) = {R} − (k mod {R})
              </span>
            )}
          </div>
          <OpsEditor
            value={input.hashOps}
            onChange={(hashOps) => update({ hashOps })}
            help={
              <>
                <code>insert 18 41 22</code>, <code>search 41</code>, <code>delete 22</code>. Keys
                are non-negative integers; h(k) = k mod m.
              </>
            }
          />
        </div>
      </Panel>
      {typeof ops === 'string' && <Alert tone="error">{ops}</Alert>}
      {steps && s && step && (
        <>
          <StepPlayer
            count={steps.length}
            index={index}
            onIndexChange={setIndex}
            label={step.label}
          />
          <Panel
            title="Table"
            actions={
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {s.count} keys · load factor α = {(s.count / input.hashSize).toFixed(2)}
              </span>
            }
          >
            <ol className="flex flex-col gap-1">
              {s.slots.map((slot, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-8 text-right font-mono text-xs text-slate-500">{i}</span>
                  <span
                    className={cx(
                      'flex min-h-9 min-w-16 items-center gap-1 rounded-md border-2 px-2 font-mono text-sm',
                      s.current === i
                        ? s.found === false
                          ? 'border-rose-500 bg-rose-50 dark:bg-rose-950'
                          : 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                        : s.probe.includes(i)
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-950'
                          : 'border-slate-200 dark:border-slate-700',
                    )}
                  >
                    {Array.isArray(slot) ? (
                      slot.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        slot.map((k, j) => (
                          <span key={j} className="flex items-center gap-1">
                            {j > 0 && <span className="text-slate-400">→</span>}
                            <span className="rounded bg-slate-200 px-1.5 font-semibold dark:bg-slate-700">
                              {k}
                            </span>
                          </span>
                        ))
                      )
                    ) : slot === null ? (
                      <span className="text-slate-400">—</span>
                    ) : slot === 'deleted' ? (
                      <span className="text-xs italic text-rose-600 dark:text-rose-400">
                        deleted
                      </span>
                    ) : (
                      <span className="font-semibold">{slot}</span>
                    )}
                  </span>
                  {s.probe.includes(i) && (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      probe {s.probe.indexOf(i)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        </>
      )}
    </div>
  );
}

export function StructuresModule({ examples }: ModuleProps) {
  const shared = useSharedInput(examples, DEFAULT_STRUCT, sanitizeStruct);
  const { input, setInput } = shared;
  const update = (patch: Partial<StructInput>) => setInput({ ...input, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader
        title="Trees, heaps & hashing"
        description="Binary search trees and AVL rotations, min/max heaps as a tree and an array, and hash tables with chaining or open addressing."
        moduleId="structures"
        examples={examples}
        exampleId={shared.exampleId}
        onLoadExample={shared.loadExample}
        input={input}
        onImport={(raw) => {
          const parsed = sanitizeStruct(raw);
          if (parsed) setInput(parsed);
          return parsed !== null;
        }}
      />
      <Tabs
        label="Structure"
        value={input.tab}
        onChange={(tab) => update({ tab })}
        options={[
          { value: 'tree', label: 'BST / AVL' },
          { value: 'heap', label: 'Heap' },
          { value: 'hash', label: 'Hash table' },
        ]}
      />
      {input.tab === 'tree' ? (
        <TreeTab input={input} update={update} />
      ) : input.tab === 'heap' ? (
        <HeapTab input={input} update={update} />
      ) : (
        <HashTab input={input} update={update} />
      )}
    </div>
  );
}
