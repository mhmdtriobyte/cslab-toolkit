import { cx } from '@oslab/core';
import type { ReactNode } from 'react';

/** Colours used by ls / grep (ANSI SGR codes) mapped to terminal-friendly classes. */
const STYLE: Record<string, string> = {
  '1': 'font-bold',
  '31': 'text-rose-400',
  '32': 'text-emerald-400',
  '33': 'text-amber-300',
  '34': 'text-sky-400',
  '35': 'text-fuchsia-400',
  '36': 'text-cyan-300',
  '30;42': 'bg-emerald-500 text-slate-950',
};

/** Renders text containing "\x1b[1;34m...\x1b[0m" escapes as coloured spans. */
export function Ansi({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  const re = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)m`, 'g');
  let last = 0;
  let classes: string[] = [];
  let m: RegExpExecArray | null;
  let k = 0;
  const push = (s: string) => {
    if (s)
      parts.push(
        classes.length ? (
          <span key={k++} className={cx(...classes)}>
            {s}
          </span>
        ) : (
          s
        ),
      );
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const code = m[1] ?? '';
    if (code === '0' || code === '') classes = [];
    else if (STYLE[code]) classes = [STYLE[code] as string];
    else
      classes = code
        .split(';')
        .map((c) => STYLE[c] ?? '')
        .filter(Boolean);
    last = re.lastIndex;
  }
  push(text.slice(last));
  return parts;
}
