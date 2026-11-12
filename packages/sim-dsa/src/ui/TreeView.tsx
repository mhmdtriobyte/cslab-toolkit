import { cx } from '@oslab/core';

export interface DrawNode {
  id: number;
  label: string;
  left: DrawNode | null;
  right: DrawNode | null;
  /** Small text under the node (balance factor, array index…). */
  note?: string;
}

const R = 18;
const DX = 44;
const DY = 64;

interface Placed {
  node: DrawNode;
  x: number;
  y: number;
  parent: Placed | null;
}

/** In-order x positions and depth y positions: the classic, never-overlapping tree drawing. */
function place(root: DrawNode | null): Placed[] {
  const out: Placed[] = [];
  let x = 0;
  const rec = (n: DrawNode | null, depth: number, parent: Placed | null) => {
    if (!n) return;
    const me: Placed = { node: n, x: 0, y: depth * DY + R + 6, parent };
    rec(n.left, depth + 1, me);
    me.x = x++ * DX + R + 6;
    out.push(me);
    rec(n.right, depth + 1, me);
  };
  rec(root, 0, null);
  return out;
}

export function TreeView({
  root,
  path = [],
  focus = null,
  changed = [],
  visited = [],
  emptyText = 'Empty tree.',
}: {
  root: DrawNode | null;
  path?: readonly number[];
  focus?: number | null;
  changed?: readonly number[];
  /** Ids already output by a traversal. */
  visited?: readonly number[];
  emptyText?: string;
}) {
  const placed = place(root);
  if (placed.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>;
  }
  const width = Math.max(...placed.map((p) => p.x)) + R + 6;
  const height = Math.max(...placed.map((p) => p.y)) + R + 22;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="mx-auto block max-w-full"
        role="img"
        aria-label="Tree drawing"
        style={{ minWidth: Math.min(width, 280) }}
      >
        {placed.map(
          (p) =>
            p.parent && (
              <line
                key={`e${p.node.id}`}
                x1={p.parent.x}
                y1={p.parent.y}
                x2={p.x}
                y2={p.y}
                className={cx(
                  'stroke-2',
                  path.includes(p.node.id) && path.includes(p.parent.node.id)
                    ? 'stroke-amber-500'
                    : 'stroke-slate-300 dark:stroke-slate-600',
                )}
              />
            ),
        )}
        {placed.map((p) => {
          const id = p.node.id;
          const isFocus = focus === id;
          const tone = isFocus
            ? 'fill-indigo-600 stroke-indigo-800'
            : changed.includes(id)
              ? 'fill-rose-500 stroke-rose-700'
              : path.includes(id)
                ? 'fill-amber-400 stroke-amber-600'
                : visited.includes(id)
                  ? 'fill-emerald-500 stroke-emerald-700'
                  : 'fill-white stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500';
          const light = isFocus || changed.includes(id) || visited.includes(id);
          return (
            <g key={id}>
              <circle cx={p.x} cy={p.y} r={R} className={cx('stroke-2 transition-colors', tone)} />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                className={cx(
                  'text-[13px] font-semibold',
                  light ? 'fill-white' : 'fill-slate-900 dark:fill-slate-100',
                )}
              >
                {p.node.label}
              </text>
              {p.node.note && (
                <text
                  x={p.x}
                  y={p.y + R + 11}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] dark:fill-slate-400"
                >
                  {p.node.note}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Legend({ items }: { items: { className: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cx('inline-block h-3 w-3 rounded-sm', i.className)} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
