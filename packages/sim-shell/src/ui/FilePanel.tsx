import { cx, Icon } from '@oslab/core';
import { basename, can, modeString, octal, ROOT, type Inode, type Shell } from '../engine';

const WHO = ['Owner', 'Group', 'Others'] as const;
const WHAT = ['read', 'write', 'execute'] as const;

/** The 3×3 grid of permission bits, the octal number and what it means for you. */
function Inspector({ shell, path, node }: { shell: Shell; path: string; node: Inode }) {
  const m = node.mode;
  const bit = (who: number, what: number) => ((m >> (6 - who * 3)) & (4 >> what)) !== 0;
  const you = shell.user;
  const youAre =
    you.uid === 0
      ? 'root'
      : node.owner === you.name
        ? 'owner'
        : you.groups.includes(node.group)
          ? 'group'
          : 'others';
  const dirWords = ['list it', 'create / delete inside', 'enter it (cd)'];
  const fileWords = ['read', 'change', 'run it'];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <code className="break-all text-sm font-semibold">{path}</code>
        <span className="font-mono text-sm">
          {modeString(node)}{' '}
          <span className="rounded bg-indigo-100 px-1 font-bold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">
            {octal(m)}
          </span>
        </span>
      </div>
      <table className="w-full table-fixed border-collapse text-center text-xs">
        <thead>
          <tr>
            <th className="w-16" />
            {WHAT.map((w) => (
              <th key={w} className="py-1 font-semibold text-slate-600 dark:text-slate-300">
                {w}
              </th>
            ))}
            <th className="w-8 text-slate-500">#</th>
          </tr>
        </thead>
        <tbody>
          {WHO.map((who, i) => (
            <tr
              key={who}
              className={cx(youAre === who.toLowerCase() && 'bg-indigo-50 dark:bg-indigo-950')}
            >
              <td className="py-1 text-left font-semibold">
                {who}
                <div className="truncate font-normal text-slate-500">
                  {i === 0 ? node.owner : i === 1 ? node.group : 'everyone'}
                </div>
              </td>
              {WHAT.map((w, j) => (
                <td key={w}>
                  <span
                    className={cx(
                      'inline-flex h-7 w-7 items-center justify-center rounded font-mono font-bold',
                      bit(i, j)
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100'
                        : 'bg-slate-100 text-slate-400 dark:bg-slate-800',
                    )}
                    title={`${who} ${bit(i, j) ? 'can' : 'cannot'} ${(node.type === 'dir' ? dirWords : fileWords)[j]}`}
                  >
                    {bit(i, j) ? 'rwx'[j] : '-'}
                  </span>
                </td>
              ))}
              <td className="font-mono font-bold">{(m >> (6 - i * 3)) & 7}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        You are <strong>{you.name}</strong>
        {youAre === 'root' ? ' (root ignores read/write bits)' : `, so the ${youAre} row applies`}:
        you can{' '}
        {WHAT.map((w, j) => {
          const allowed = can(node, you, w[0] as 'r' | 'w' | 'x');
          return (
            <span
              key={w}
              className={cx(
                'font-semibold',
                allowed
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-rose-600 line-through dark:text-rose-400',
              )}
            >
              {(node.type === 'dir' ? dirWords : fileWords)[j]}
              {j < 2 ? ', ' : ''}
            </span>
          );
        })}
        .
      </p>
    </div>
  );
}

export function FilePanel({
  shell,
  root,
  selected,
  onSelect,
}: {
  shell: Shell;
  root: string;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  let entries: { path: string; node: Inode; depth: number }[] = [];
  try {
    // Shown as an all-seeing observer so students also see what they are not allowed to open.
    entries = shell.fs.walk(root, ROOT).filter((e) => e.depth <= 4);
  } catch {
    entries = [];
  }
  const sel = selected ? entries.find((e) => e.path === selected) : undefined;
  return (
    <div className="flex flex-col gap-2">
      <ul
        className="max-h-72 overflow-auto rounded-md bg-slate-50 py-1 font-mono text-[0.8rem] dark:bg-slate-950"
        aria-label="Files"
      >
        {entries.map(({ path, node, depth }) => {
          const name = depth === 0 ? path : basename(path);
          const here = path === shell.cwd;
          return (
            <li key={path}>
              <button
                type="button"
                onClick={() => onSelect(path)}
                className={cx(
                  'flex w-full items-center gap-2 px-2 py-0.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950',
                  selected === path && 'bg-indigo-100 dark:bg-indigo-900',
                )}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                title={here ? 'You are here' : undefined}
              >
                <span className="text-slate-500">{modeString(node)}</span>
                <span
                  className={cx(
                    'truncate',
                    node.type === 'dir'
                      ? 'font-semibold text-sky-700 dark:text-sky-400'
                      : node.mode & 0o111
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : '',
                  )}
                >
                  {name}
                  {node.type === 'dir' && depth > 0 ? '/' : ''}
                </span>
                {node.owner !== 'student' && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">{node.owner}</span>
                )}
                {here && (
                  <span className="ml-auto flex items-center gap-0.5 text-xs font-sans font-semibold text-indigo-700 dark:text-indigo-300">
                    <Icon name="arrowRight" className="h-3 w-3" /> you
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {sel ? (
        <Inspector shell={shell} path={sel.path} node={sel.node} />
      ) : (
        <p className="text-xs text-slate-500">Click a file to see its permissions as a grid.</p>
      )}
    </div>
  );
}
