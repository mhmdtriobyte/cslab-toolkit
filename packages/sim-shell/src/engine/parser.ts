/**
 * A small POSIX-style shell parser: quotes, backslashes, $VAR / ${VAR} / $? / $1, $(command),
 * ~, comments, pipes, redirections and the && || ; & list operators.
 */

export type Part =
  | { kind: 'lit'; text: string; quoted: boolean }
  | { kind: 'var'; name: string; quoted: boolean }
  | { kind: 'subst'; source: string; quoted: boolean }
  | { kind: 'arith'; expr: string; quoted: boolean }
  | { kind: 'tilde' };

export type Word = Part[];

export type RedirectOp = '>' | '>>' | '<' | '2>' | '2>>' | '2>&1' | '&>';

export interface Redirect {
  op: RedirectOp;
  target: Word | null;
}

export interface SimpleCommand {
  assigns: { name: string; value: Word }[];
  words: Word[];
  redirects: Redirect[];
}

export type ListOp = '&&' | '||' | ';' | '&';

export interface ListItem {
  pipeline: SimpleCommand[];
  /** Operator after this pipeline (';' for the last one). */
  op: ListOp;
}

export class ParseError extends Error {}

type Token = { t: 'word'; word: Word } | { t: 'op'; op: string };

const OPS = ['2>&1', '2>>', '&>', '>>', '&&', '||', '2>', '|', '&', ';', '>', '<'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let word: Word | null = null;
  const lit = (text: string, quoted: boolean) => {
    word ??= [];
    const last = word[word.length - 1];
    if (last?.kind === 'lit' && last.quoted === quoted) last.text += text;
    else word.push({ kind: 'lit', text, quoted });
  };
  const flush = () => {
    if (word) tokens.push({ t: 'word', word });
    word = null;
  };

  /** Reads $... at src[i] (src[i] === '$'), pushing a var or subst part. */
  const dollar = (quoted: boolean) => {
    const next = src[i + 1];
    if (src.startsWith('$((', i)) {
      const end = src.indexOf('))', i + 3);
      if (end < 0) throw new ParseError('unexpected end of input: missing ))');
      word ??= [];
      word.push({ kind: 'arith', expr: src.slice(i + 3, end), quoted });
      i = end + 2;
      return;
    }
    if (next === '(') {
      let depth = 1;
      let j = i + 2;
      let q: string | null = null;
      while (j < src.length && depth > 0) {
        const c = src[j] as string;
        if (q) {
          if (c === q) q = null;
          else if (c === '\\' && q === '"') j++;
        } else if (c === "'" || c === '"') q = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        j++;
      }
      if (depth > 0) throw new ParseError('unexpected end of input: missing )');
      word ??= [];
      word.push({ kind: 'subst', source: src.slice(i + 2, j - 1), quoted });
      i = j;
      return;
    }
    if (next === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new ParseError('bad substitution: missing }');
      word ??= [];
      word.push({ kind: 'var', name: src.slice(i + 2, end), quoted });
      i = end + 1;
      return;
    }
    const special = /^[?$#@0-9]/.exec(src.slice(i + 1));
    if (special) {
      word ??= [];
      word.push({ kind: 'var', name: special[0], quoted });
      i += 2;
      return;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1));
    if (name) {
      word ??= [];
      word.push({ kind: 'var', name: name[0], quoted });
      i += 1 + name[0].length;
      return;
    }
    lit('$', quoted);
    i++;
  };

  while (i < src.length) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t' || c === '\n') {
      flush();
      i++;
      continue;
    }
    if (c === '#' && word === null) break;
    if (
      word === null &&
      c === '~' &&
      (i + 1 === src.length || /[\s/]/.test(src[i + 1] as string))
    ) {
      word = [{ kind: 'tilde' }];
      i++;
      continue;
    }
    // "2>" and friends only redirect at the start of a word: echo a2>b is "a2" > b.
    const op = OPS.find((o) => src.startsWith(o, i) && (o[0] !== '2' || word === null));
    if (op) {
      flush();
      tokens.push({ t: 'op', op });
      i += op.length;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new ParseError("unexpected end of input: missing '");
      lit(src.slice(i + 1, end), true);
      word ??= [];
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      word ??= [];
      let closed = false;
      while (i < src.length) {
        const d = src[i] as string;
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1] as string)) {
          lit(src[i + 1] as string, true);
          i += 2;
        } else if (d === '$') dollar(true);
        else {
          lit(d, true);
          i++;
        }
      }
      if (!closed) throw new ParseError('unexpected end of input: missing "');
      continue;
    }
    if (c === '\\') {
      if (i + 1 < src.length) lit(src[i + 1] as string, true);
      i += 2;
      continue;
    }
    if (c === '$') {
      dollar(false);
      continue;
    }
    lit(c, false);
    i++;
  }
  flush();
  return tokens;
}

export function parse(src: string): ListItem[] {
  const tokens = tokenize(src);
  const items: ListItem[] = [];
  let pipeline: SimpleCommand[] = [];
  let cmd: SimpleCommand = { assigns: [], words: [], redirects: [] };
  const empty = (c: SimpleCommand) =>
    c.words.length === 0 && c.assigns.length === 0 && c.redirects.length === 0;

  const endCommand = (opText: string) => {
    if (empty(cmd)) throw new ParseError(`syntax error near unexpected token \`${opText}'`);
    pipeline.push(cmd);
    cmd = { assigns: [], words: [], redirects: [] };
  };

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k] as Token;
    if (tok.t === 'word') {
      const first = tok.word[0];
      const assign =
        cmd.words.length === 0 && first?.kind === 'lit' && !first.quoted
          ? /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(first.text)
          : null;
      if (assign && first?.kind === 'lit') {
        cmd.assigns.push({
          name: assign[1] as string,
          value: [{ ...first, text: first.text.slice(assign[0].length) }, ...tok.word.slice(1)],
        });
      } else cmd.words.push(tok.word);
      continue;
    }
    const op = tok.op;
    if (op === '|') {
      endCommand('|');
      continue;
    }
    if (op === '&&' || op === '||' || op === ';' || op === '&') {
      if (empty(cmd) && pipeline.length === 0) {
        if (op === ';' && items.length === 0) continue;
        throw new ParseError(`syntax error near unexpected token \`${op}'`);
      }
      endCommand(op);
      items.push({ pipeline, op });
      pipeline = [];
      continue;
    }
    // Redirection.
    if (op === '2>&1') {
      cmd.redirects.push({ op, target: null });
      continue;
    }
    const next = tokens[k + 1];
    if (!next || next.t !== 'word')
      throw new ParseError("syntax error near unexpected token `newline'");
    cmd.redirects.push({ op: op as RedirectOp, target: next.word });
    k++;
  }
  if (!empty(cmd)) {
    pipeline.push(cmd);
  } else if (pipeline.length > 0) {
    throw new ParseError("syntax error: unexpected end of input after '|'");
  }
  if (pipeline.length > 0) items.push({ pipeline, op: ';' });
  else if (items.length > 0) {
    const last = items[items.length - 1] as ListItem;
    if (last.op === '&&' || last.op === '||')
      throw new ParseError(`syntax error: unexpected end of input after '${last.op}'`);
  }
  return items;
}

/** True if a word has unquoted glob characters, so it should be expanded against the filesystem. */
export function globPattern(w: Word): string | null {
  let pattern = '';
  let glob = false;
  for (const p of w) {
    if (p.kind !== 'lit') return null;
    if (!p.quoted && /[*?[]/.test(p.text)) glob = true;
    pattern += p.quoted ? p.text.replace(/[*?[\]\\]/g, '\\$&') : p.text;
  }
  return glob ? pattern : null;
}

/** Shell glob → RegExp for one path component. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '\\' && i + 1 < glob.length) re += `\\${glob[++i]}`;
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        let set = glob.slice(i + 1, end);
        if (set.startsWith('!')) set = `^${set.slice(1)}`;
        re += `[${set.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Integer arithmetic for $(( )): + - * / % ** comparisons && || ! and parentheses. Bare names are
 * variables (unset or non-numeric = 0), like bash.
 */
export function evalArith(expr: string, getVar: (name: string) => string): number {
  const tokens = expr.match(/\d+|[A-Za-z_]\w*|\$\w+|\*\*|[<>=!]=|&&|\|\||[-+*/%()<>!]/g) ?? [];
  let k = 0;
  const peek = () => tokens[k];
  const take = () => tokens[k++];
  const num = (t: string) => {
    const v = t.startsWith('$') ? getVar(t.slice(1)) : /^\d/.test(t) ? t : getVar(t);
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const primary = (): number => {
    const t = take();
    if (t === undefined) throw new ParseError('arithmetic syntax error');
    if (t === '(') {
      const v = or();
      if (take() !== ')') throw new ParseError('arithmetic syntax error: missing )');
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (t === '!') return primary() ? 0 : 1;
    return num(t);
  };
  const power = (): number => {
    const b = primary();
    if (peek() === '**') {
      take();
      return b ** power();
    }
    return b;
  };
  const mul = (): number => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take();
      const r = power();
      if ((op === '/' || op === '%') && r === 0) throw new ParseError('division by 0');
      v = op === '*' ? v * r : op === '/' ? Math.trunc(v / r) : v % r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + mul() : v - mul();
    return v;
  };
  const cmp = (): number => {
    let v = add();
    for (;;) {
      const op = peek();
      if (!op || !['<', '>', '<=', '>=', '==', '!='].includes(op)) return v;
      take();
      const r = add();
      v = Number(
        op === '<'
          ? v < r
          : op === '>'
            ? v > r
            : op === '<='
              ? v <= r
              : op === '>='
                ? v >= r
                : op === '=='
                  ? v === r
                  : v !== r,
      );
    }
  };
  const and = (): number => {
    let v = cmp();
    while (peek() === '&&') {
      take();
      const r = cmp();
      v = Number(v !== 0 && r !== 0);
    }
    return v;
  };
  const or = (): number => {
    let v = and();
    while (peek() === '||') {
      take();
      const r = and();
      v = Number(v !== 0 || r !== 0);
    }
    return v;
  };
  const result = or();
  if (k < tokens.length) throw new ParseError(`arithmetic syntax error near "${tokens[k]}"`);
  return result;
}
