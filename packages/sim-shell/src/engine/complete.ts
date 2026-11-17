import { COMMANDS } from './commands';
import type { Shell } from './shell';

export interface Completion {
  /** The input line after completing as far as possible. */
  line: string;
  /** Several candidates: show them, like pressing Tab twice in bash. */
  options: string[];
}

function commonPrefix(words: string[]): string {
  if (words.length === 0) return '';
  let p = words[0] as string;
  for (const w of words) while (!w.startsWith(p)) p = p.slice(0, -1);
  return p;
}

/** Bash-style Tab completion of the last word: command names first, then paths. */
export function complete(shell: Shell, line: string): Completion {
  const m = /(^|[\s|;&<>]+)([^\s|;&<>]*)$/.exec(line);
  const word = m?.[2] ?? '';
  const before = line.slice(0, line.length - word.length);
  const isCommand = before.trim() === '' || /[|;&]\s*$/.test(before) || /^\s*sudo\s+$/.test(before);

  if (isCommand && !word.includes('/')) {
    const names = [...new Set([...Object.keys(COMMANDS), ...shell.aliases.keys()])]
      .filter((c) => c.startsWith(word) && /^[a-z]/.test(c))
      .sort();
    if (names.length === 1) return { line: `${before}${names[0]} `, options: [] };
    const prefix = commonPrefix(names);
    return {
      line: before + (prefix.length > word.length ? prefix : word),
      options: prefix.length > word.length ? [] : names,
    };
  }

  const expanded = word.startsWith('~') ? shell.home + word.slice(1) : word;
  const slash = expanded.lastIndexOf('/');
  const dirPart = slash >= 0 ? expanded.slice(0, slash + 1) : '';
  const namePart = slash >= 0 ? expanded.slice(slash + 1) : expanded;
  let entries: [string, { type: string }][];
  try {
    entries = shell.fs.list(shell.abs(dirPart || '.'), shell.user);
  } catch {
    return { line, options: [] };
  }
  const matches = entries
    .filter(([n]) => n.startsWith(namePart) && (namePart.startsWith('.') || !n.startsWith('.')))
    .map(([n, node]) => n + (node.type === 'dir' ? '/' : ''));
  const shownDir = word.slice(0, word.length - namePart.length);
  if (matches.length === 1) {
    const only = matches[0] as string;
    return { line: before + shownDir + only + (only.endsWith('/') ? '' : ' '), options: [] };
  }
  const prefix = commonPrefix(matches);
  if (prefix.length > namePart.length) return { line: before + shownDir + prefix, options: [] };
  return { line, options: matches };
}
