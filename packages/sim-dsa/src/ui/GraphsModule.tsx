import {
  Alert,
  cx,
  Field,
  ModuleHeader,
  Panel,
  Select,
  StepPlayer,
  tableClass,
  Toggle,
  useSharedInput,
  useStepIndex,
  type ModuleProps,
} from '@oslab/core';
import { useMemo } from 'react';
import {
  circleLayout,
  GRAPH_ALGORITHMS,
  graphSteps,
  parseGraph,
  type Graph,
  type GraphAlgorithm,
  type GraphState,
} from '../engine';
import { DEFAULT_GRAPH, sanitizeGraph, type GraphInput } from './input';
import { Legend } from './TreeView';

const W = 560;
const H = 420;
const NR = 20;

const NOTE: Record<GraphAlgorithm, string> = {
  bfs: 'd',
  dfs: 't',
  dijkstra: 'd',
  prim: 'w',
  kruskal: '',
  topo: 'in',
};

function GraphDrawing({ g, s, algorithm }: { g: Graph; s: GraphState; algorithm: GraphAlgorithm }) {
  const pos = circleLayout(g.nodes);
  const at = (n: string) => {
    const p = pos[n] as { x: number; y: number };
    return { x: 30 + p.x * (W - 60), y: 24 + p.y * (H - 48) };
  };
  const note = NOTE[algorithm];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Graph drawing">
      <defs>
        {['slate', 'amber', 'emerald', 'rose'].map((c) => (
          <marker
            key={c}
            id={`arrow-${c}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              className={
                c === 'slate'
                  ? 'fill-slate-400'
                  : c === 'amber'
                    ? 'fill-amber-500'
                    : c === 'emerald'
                      ? 'fill-emerald-600'
                      : 'fill-rose-500'
              }
            />
          </marker>
        ))}
      </defs>
      {g.edges.map((e, i) => {
        const a = at(e.from);
        const b = at(e.to);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const x1 = a.x + (dx / len) * NR;
        const y1 = a.y + (dy / len) * NR;
        const x2 = b.x - (dx / len) * (NR + (g.directed ? 3 : 0));
        const y2 = b.y - (dy / len) * (NR + (g.directed ? 3 : 0));
        const tone =
          s.edge === i
            ? 'amber'
            : s.rejected.includes(i)
              ? 'rose'
              : s.tree.includes(i)
                ? 'emerald'
                : 'slate';
        const stroke = {
          amber: 'stroke-amber-500',
          rose: 'stroke-rose-500',
          emerald: 'stroke-emerald-600',
          slate: 'stroke-slate-300 dark:stroke-slate-600',
        }[tone];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const weighted = g.edges.some((x) => x.weight !== 1);
        return (
          <g key={i}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={cx(stroke, tone === 'slate' ? 'stroke-2' : 'stroke-[3.5]')}
              strokeDasharray={tone === 'rose' ? '6 4' : undefined}
              markerEnd={g.directed ? `url(#arrow-${tone})` : undefined}
            />
            {weighted && (
              <g>
                <rect
                  x={mx - 11}
                  y={my - 9}
                  width={22}
                  height={18}
                  rx={4}
                  className="fill-white stroke-slate-200 dark:fill-slate-900 dark:stroke-slate-700"
                />
                <text
                  x={mx}
                  y={my}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-700 text-[11px] font-semibold dark:fill-slate-200"
                >
                  {e.weight}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {g.nodes.map((n) => {
        const p = at(n);
        const tone =
          s.current === n
            ? 'fill-indigo-600 stroke-indigo-800'
            : s.done.includes(n)
              ? 'fill-emerald-500 stroke-emerald-700'
              : s.frontier.includes(n)
                ? 'fill-amber-300 stroke-amber-600'
                : 'fill-white stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500';
        const light = s.current === n || s.done.includes(n);
        const value = s.dist[n];
        return (
          <g key={n}>
            <circle cx={p.x} cy={p.y} r={NR} className={cx('stroke-2', tone)} />
            <text
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={cx(
                'text-sm font-bold',
                light ? 'fill-white' : 'fill-slate-900 dark:fill-slate-100',
              )}
            >
              {n}
            </text>
            {note && (
              <text
                x={p.x}
                y={p.y - NR - 6}
                textAnchor="middle"
                className="fill-indigo-700 text-[11px] font-semibold dark:fill-indigo-300"
              >
                {note}={value === null || value === undefined ? '∞' : value}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function GraphsModule({ examples }: ModuleProps) {
  const shared = useSharedInput(examples, DEFAULT_GRAPH, sanitizeGraph);
  const { input, setInput } = shared;
  const update = (patch: Partial<GraphInput>) => setInput({ ...input, ...patch });
  const g = useMemo(() => parseGraph(input.graph, input.directed), [input.graph, input.directed]);
  const steps = useMemo(
    () => (typeof g === 'string' ? g : graphSteps(g, input.algorithm, input.start)),
    [g, input.algorithm, input.start],
  );
  const [index, setIndex] = useStepIndex(steps);
  const info = GRAPH_ALGORITHMS.find((a) => a.value === input.algorithm);
  const step = typeof steps === 'string' ? null : steps[Math.min(index, steps.length - 1)];
  const s = step?.state;
  const showDist = ['bfs', 'dijkstra', 'prim', 'dfs', 'topo'].includes(input.algorithm);
  const distHeader: Record<GraphAlgorithm, string> = {
    bfs: 'Hops',
    dfs: 'Discovered at',
    dijkstra: 'Distance',
    prim: 'Edge weight',
    kruskal: '',
    topo: 'In-degree',
  };

  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader
        title="Graph algorithms"
        description="BFS, DFS, Dijkstra, Prim, Kruskal and topological sort, step by step on a graph you type."
        moduleId="graphs"
        examples={examples}
        exampleId={shared.exampleId}
        onLoadExample={shared.loadExample}
        input={input}
        onImport={(raw) => {
          const parsed = sanitizeGraph(raw);
          if (parsed) setInput(parsed);
          return parsed !== null;
        }}
      />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Graph">
          <div className="flex flex-col gap-3">
            <Field label="Edges: one per line, “from to weight” (weight optional)">
              <textarea
                value={input.graph}
                onChange={(e) => update({ graph: e.target.value })}
                rows={9}
                spellCheck={false}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </Field>
            <Toggle
              checked={input.directed}
              onChange={(directed) => update({ directed })}
              label="Directed (A B means A → B)"
            />
            <Field label="Algorithm">
              <Select
                value={input.algorithm}
                onChange={(e) => update({ algorithm: e.target.value as GraphAlgorithm })}
              >
                {GRAPH_ALGORITHMS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            {info?.needsStart && typeof g !== 'string' && (
              <Field label="Start node">
                <Select
                  value={g.nodes.includes(input.start) ? input.start : g.nodes[0]}
                  onChange={(e) => update({ start: e.target.value })}
                >
                  {g.nodes.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ties are broken alphabetically, the convention used when tracing by hand.
            </p>
          </div>
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          {typeof steps === 'string' && <Alert tone="error">{steps}</Alert>}
          {typeof steps !== 'string' && s && step && typeof g !== 'string' && (
            <>
              <StepPlayer
                count={steps.length}
                index={index}
                onIndexChange={setIndex}
                label={step.label}
              />
              <Panel title={info?.label}>
                <GraphDrawing g={g} s={s} algorithm={input.algorithm} />
                <Legend
                  items={[
                    { className: 'bg-indigo-600', label: 'current' },
                    { className: 'bg-amber-300', label: 'in the frontier' },
                    { className: 'bg-emerald-500', label: 'done / in the tree' },
                    { className: 'bg-rose-500', label: 'rejected edge' },
                  ]}
                />
              </Panel>
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title={s.frontierLabel}>
                  <p className="font-mono text-sm">
                    {s.frontier.length
                      ? s.frontier.join(input.algorithm === 'kruskal' ? '  ' : ', ')
                      : '(empty)'}
                  </p>
                  {s.order.length > 0 && (
                    <p className="mt-2 text-sm">
                      {input.algorithm === 'topo' ? 'Order' : 'Visited'}:{' '}
                      <strong className="font-mono">{s.order.join(' → ')}</strong>
                    </p>
                  )}
                </Panel>
                {showDist && (
                  <Panel title="Table">
                    <div className="relative overflow-x-auto">
                      <table className={tableClass}>
                        <thead>
                          <tr>
                            <th>Node</th>
                            <th className="text-right">{distHeader[input.algorithm]}</th>
                            {input.algorithm !== 'topo' && (
                              <th>{input.algorithm === 'dfs' ? 'Parent' : 'Previous'}</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {g.nodes.map((n) => (
                            <tr
                              key={n}
                              className={cx(s.current === n && 'bg-indigo-50 dark:bg-indigo-950')}
                            >
                              <td className="font-semibold">{n}</td>
                              <td className="text-right tabular-nums">{s.dist[n] ?? '∞'}</td>
                              {input.algorithm !== 'topo' && <td>{s.prev[n] ?? '–'}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
