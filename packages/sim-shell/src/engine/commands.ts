import { basename, can, errorText, FsError, modeString, octal, ROOT, type Inode } from './fs';
import { ExitSignal, fail, ok, parseDuration, type Ctx, type Result, type Shell } from './shell';

export type CommandFn = (ctx: Ctx) => Result;

// ---- Helpers ----

const ESC = '\u001b[';
const color = (text: string, code: string, on: boolean) =>
  on ? `${ESC}${code}m${text}${ESC}0m` : text;

/** Splits "-la", "-n", "5" style options. Returns flags, values for options that take one, operands. */
function getopt(
  args: string[],
  withValue: string = '',
): { flags: Set<string>; values: Map<string, string>; rest: string[]; bad: string | null } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const rest: string[] = [];
  let bad: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      flags.add(a);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j] as string;
        if (withValue.includes(f)) {
          const v = a.slice(j + 1) || args[++i];
          if (v === undefined) bad = `option requires an argument -- '${f}'`;
          else values.set(f, v);
          break;
        }
        flags.add(f);
      }
      continue;
    }
    rest.push(a);
  }
  return { flags, values, rest, bad };
}

function unknownFlags(flags: Set<string>, allowed: string, cmd: string): Result | null {
  for (const f of flags) {
    if (f.startsWith('--')) {
      if (f === '--help') return null;
      continue;
    }
    if (!allowed.includes(f))
      return fail(
        `${cmd}: invalid option -- '${f}'\nTry 'man ${cmd}' for the options supported here.`,
        2,
      );
  }
  return null;
}

/** Reads each file operand (or stdin when there are none), reporting errors like coreutils. */
function inputs(ctx: Ctx, files: string[]): { name: string; text: string }[] | Result {
  if (files.length === 0 || (files.length === 1 && files[0] === '-'))
    return [{ name: '', text: ctx.stdin }];
  const out: { name: string; text: string }[] = [];
  for (const f of files) {
    try {
      out.push({ name: f, text: ctx.shell.fs.read(ctx.shell.abs(f), ctx.shell.user) });
    } catch (e) {
      return ctx.shell.fsError(ctx.name, e, f);
    }
  }
  return out;
}

const lines = (text: string) => {
  const ls = text.split('\n');
  if (ls[ls.length - 1] === '') ls.pop();
  return ls;
};
const joinLines = (ls: string[]) => (ls.length ? `${ls.join('\n')}\n` : '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function lsDate(t: number) {
  const d = new Date(t * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function sizeOf(n: Inode): number {
  return n.type === 'dir' ? 4096 : new TextEncoder().encode(n.content).length;
}

function human(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const units = ['K', 'M', 'G'];
  let v = bytes;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${units[u]}`;
}

function colourName(name: string, n: Inode, on: boolean): string {
  if (n.type === 'dir') return color(name, (n.mode & 0o1002) === 0o1002 ? '30;42' : '1;34', on);
  if (n.mode & 0o111) return color(name, '1;32', on);
  return name;
}

// ---- Navigation and files ----

const pwd: CommandFn = ({ shell }) => ok(`${shell.cwd}\n`);

const cd: CommandFn = ({ shell, args }) => {
  const target =
    args[0] === undefined || args[0] === '~'
      ? shell.home
      : args[0] === '-'
        ? shell.oldPwd
        : args[0];
  if (args.length > 1) return fail('bash: cd: too many arguments');
  const abs = shell.abs(target);
  try {
    const node = shell.fs.lookup(abs, shell.user);
    if (node.type !== 'dir') return fail(`bash: cd: ${target}: Not a directory`);
    if (!can(node, shell.user, 'x')) return fail(`bash: cd: ${target}: Permission denied`);
  } catch (e) {
    if (e instanceof FsError) return fail(`bash: cd: ${target}: ${errorText(e)}`);
    throw e;
  }
  shell.oldPwd = shell.cwd;
  shell.cwd = abs;
  return ok(args[0] === '-' ? `${abs}\n` : '');
};

const ls: CommandFn = (ctx) => {
  const { shell } = ctx;
  const { flags, rest } = getopt(ctx.args);
  const badOpt = unknownFlags(flags, 'laAhRd1trSiF', 'ls');
  if (badOpt) return badOpt;
  const long = flags.has('l');
  const all = flags.has('a');
  const almost = flags.has('A');
  const out: string[] = [];
  let err = '';
  const operands = rest.length ? rest : ['.'];

  const formatLong = (entries: [string, Inode][]) => {
    if (entries.length === 0) return [];
    const rows = entries.map(([name, n]) => {
      const links =
        n.type === 'dir' ? 2 + [...n.children.values()].filter((c) => c.type === 'dir').length : 1;
      const size = flags.has('h') ? human(sizeOf(n)) : String(sizeOf(n));
      return [
        modeString(n),
        String(links),
        n.owner,
        n.group,
        size,
        lsDate(n.mtime),
        colourName(name, n, ctx.tty),
      ];
    });
    const width = (i: number) => Math.max(...rows.map((r) => (r[i] as string).length));
    return rows.map((r) =>
      [
        r[0],
        (r[1] as string).padStart(width(1)),
        (r[2] as string).padEnd(width(2)),
        (r[3] as string).padEnd(width(3)),
        (r[4] as string).padStart(width(4)),
        r[5],
        r[6],
      ].join(' '),
    );
  };

  const sortEntries = (entries: [string, Inode][]) => {
    if (flags.has('t')) entries.sort((a, b) => b[1].mtime - a[1].mtime || a[0].localeCompare(b[0]));
    else if (flags.has('S'))
      entries.sort((a, b) => sizeOf(b[1]) - sizeOf(a[1]) || a[0].localeCompare(b[0]));
    if (flags.has('r')) entries.reverse();
    return entries;
  };

  const show = (entries: [string, Inode][]) => {
    sortEntries(entries);
    if (long) out.push(...formatLong(entries));
    else if (flags.has('1') || !ctx.tty)
      out.push(...entries.map(([n, node]) => colourName(n, node, ctx.tty)));
    else if (entries.length)
      out.push(
        entries
          .map(
            ([n, node]) =>
              colourName(n, node, ctx.tty) + (flags.has('F') && node.type === 'dir' ? '/' : ''),
          )
          .join('  '),
      );
  };

  const files: [string, Inode][] = [];
  const dirs: string[] = [];
  for (const op of operands) {
    try {
      const node = shell.fs.lookup(shell.abs(op), shell.user);
      if (node.type === 'dir' && !flags.has('d')) dirs.push(op);
      else files.push([op, node]);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `ls: cannot access '${op}': ${errorText(e)}\n`;
    }
  }
  show(files);

  const listDir = (op: string, header: boolean) => {
    const abs = shell.abs(op);
    let entries: [string, Inode][];
    try {
      entries = shell.fs.list(abs, shell.user);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `ls: cannot open directory '${op}': ${errorText(e)}\n`;
      return;
    }
    if (header) {
      if (out.length) out.push('');
      out.push(`${op}:`);
    }
    if (long) out.push(`total ${entries.length * 4}`);
    let shown = entries.filter(([n]) => all || almost || !n.startsWith('.'));
    if (all) {
      const self = shell.fs.lookup(abs, shell.user);
      const parent = shell.fs.lookup(shell.dirOf(abs) || '/', shell.user);
      shown = [['.', self], ['..', parent], ...shown];
    }
    show(shown);
    if (flags.has('R')) {
      for (const [name, n] of entries) {
        if (n.type === 'dir' && (all || almost || !name.startsWith('.')))
          listDir(op === '/' ? `/${name}` : `${op}/${name}`, true);
      }
    }
  };
  dirs.forEach((d) => listDir(d, operands.length > 1 || flags.has('R')));
  return { out: joinLines(out), err, code: err ? 2 : 0 };
};

const mkdir: CommandFn = ({ shell, args }) => {
  const { flags, values, rest } = getopt(args, 'm');
  if (rest.length === 0) return fail('mkdir: missing operand');
  let err = '';
  for (const path of rest) {
    const abs = shell.abs(path);
    try {
      if (flags.has('p')) {
        const parts = abs.split('/').filter(Boolean);
        let at = '';
        for (const p of parts) {
          at += `/${p}`;
          if (!shell.fs.exists(at, shell.user)) shell.fs.create(at, 'dir', shell.user, shell.umask);
        }
      } else shell.fs.create(abs, 'dir', shell.user, shell.umask);
      const m = values.get('m');
      if (m && /^[0-7]{3,4}$/.test(m)) shell.fs.lookup(abs, shell.user).mode = parseInt(m, 8);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `mkdir: cannot create directory '${path}': ${errorText(e)}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

const rmdir: CommandFn = ({ shell, args }) => {
  if (args.length === 0) return fail('rmdir: missing operand');
  let err = '';
  for (const path of args) {
    try {
      const node = shell.fs.lookup(shell.abs(path), shell.user);
      if (node.type !== 'dir') throw new FsError('ENOTDIR', path);
      shell.fs.remove(shell.abs(path), shell.user);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `rmdir: failed to remove '${path}': ${errorText(e)}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

const touch: CommandFn = ({ shell, args }) => {
  if (args.length === 0) return fail('touch: missing file operand');
  let err = '';
  for (const path of args) {
    const abs = shell.abs(path);
    try {
      if (shell.fs.exists(abs, shell.user)) {
        const node = shell.fs.lookup(abs, shell.user);
        if (!can(node, shell.user, 'w') && node.owner !== shell.user.name && shell.user.uid !== 0)
          throw new FsError('EACCES', path);
        node.mtime = shell.fs.now;
      } else shell.fs.create(abs, 'file', shell.user, shell.umask);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `touch: cannot touch '${path}': ${errorText(e)}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

const rm: CommandFn = ({ shell, args }) => {
  const { flags, rest } = getopt(args);
  const recursive = flags.has('r') || flags.has('R');
  const force = flags.has('f');
  if (rest.length === 0) return force ? ok() : fail('rm: missing operand');
  let err = '';
  for (const path of rest) {
    const abs = shell.abs(path);
    try {
      const node = shell.fs.lookup(abs, shell.user);
      if (abs === '/') {
        err += "rm: it is dangerous to operate recursively on '/'\n";
        continue;
      }
      if (node.type === 'dir' && !recursive) {
        err += `rm: cannot remove '${path}': Is a directory\n`;
        continue;
      }
      shell.fs.remove(abs, shell.user, recursive);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      if (force && e.code === 'ENOENT') continue;
      err += `rm: cannot remove '${path}': ${errorText(e)}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

function targetFor(shell: Shell, src: string, dest: string, many: boolean): string | Result {
  const destAbs = shell.abs(dest);
  let isDir = false;
  try {
    isDir = shell.fs.lookup(destAbs, shell.user).type === 'dir';
  } catch {
    isDir = false;
  }
  if (many && !isDir) return fail(`target '${dest}' is not a directory`);
  return isDir ? `${destAbs === '/' ? '' : destAbs}/${basename(shell.abs(src))}` : destAbs;
}

const cp: CommandFn = ({ shell, args }) => {
  const { flags, rest } = getopt(args);
  if (rest.length < 2)
    return fail(
      rest.length
        ? `cp: missing destination file operand after '${rest[0]}'`
        : 'cp: missing file operand',
    );
  const dest = rest.pop() as string;
  let err = '';
  for (const src of rest) {
    const to = targetFor(shell, src, dest, rest.length > 1);
    if (typeof to !== 'string') return fail(`cp: ${to.err}`);
    try {
      const node = shell.fs.lookup(shell.abs(src), shell.user);
      if (node.type === 'dir' && !(flags.has('r') || flags.has('R'))) {
        err += `cp: -r not specified; omitting directory '${src}'\n`;
        continue;
      }
      if (to.startsWith(`${shell.abs(src)}/`)) {
        err += `cp: cannot copy a directory, '${src}', into itself\n`;
        continue;
      }
      shell.fs.copy(shell.abs(src), to, shell.user, shell.umask);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `cp: cannot copy '${src}': ${errorText(e)}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

const mv: CommandFn = ({ shell, args }) => {
  const { rest } = getopt(args);
  if (rest.length < 2)
    return fail(
      rest.length
        ? `mv: missing destination file operand after '${rest[0]}'`
        : 'mv: missing file operand',
    );
  const dest = rest.pop() as string;
  let err = '';
  for (const src of rest) {
    const to = targetFor(shell, src, dest, rest.length > 1);
    if (typeof to !== 'string') return fail(`mv: ${to.err}`);
    try {
      shell.fs.move(shell.abs(src), to, shell.user);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `mv: cannot move '${src}' to '${dest}': ${errorText(e)}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

// ---- Reading and filtering text ----

const cat: CommandFn = (ctx) => {
  const { flags, rest } = getopt(ctx.args);
  const ins = inputs(ctx, rest);
  if (!Array.isArray(ins)) return ins;
  let text = ins.map((i) => i.text).join('');
  if (flags.has('n'))
    text = joinLines(lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`));
  return ok(text);
};

const head: CommandFn = (ctx) => {
  const args = ctx.args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
  const { values, rest } = getopt(args, 'n');
  const n = Number(values.get('n') ?? 10);
  const ins = inputs(ctx, rest);
  if (!Array.isArray(ins)) return ins;
  const many = ins.length > 1;
  return ok(
    ins
      .map(
        (i, k) =>
          (many ? `${k ? '\n' : ''}==> ${i.name} <==\n` : '') +
          joinLines(
            ctx.name === 'head'
              ? lines(i.text).slice(0, n)
              : n === 0
                ? []
                : lines(i.text).slice(-n),
          ),
      )
      .join(''),
  );
};

const wc: CommandFn = (ctx) => {
  const { flags, rest } = getopt(ctx.args);
  const ins = inputs(ctx, rest);
  if (!Array.isArray(ins)) return ins;
  const pick = flags.size
    ? ['l', 'w', 'c'].filter((f) => flags.has(f) || (f === 'c' && flags.has('m')))
    : ['l', 'w', 'c'];
  const count = (t: string) => ({
    l: (t.match(/\n/g) ?? []).length,
    w: t.split(/\s+/).filter(Boolean).length,
    c: new TextEncoder().encode(t).length,
  });
  const rows = ins.map((i) => ({ name: i.name, c: count(i.text) }));
  if (rows.length > 1) {
    rows.push({
      name: 'total',
      c: rows.reduce((a, r) => ({ l: a.l + r.c.l, w: a.w + r.c.w, c: a.c + r.c.c }), {
        l: 0,
        w: 0,
        c: 0,
      }),
    });
  }
  const single = pick.length === 1 && rows.length === 1 && !rows[0]?.name;
  return ok(
    joinLines(
      rows.map((r) => {
        const nums = pick.map((p) => String(r.c[p as 'l' | 'w' | 'c']));
        return single
          ? nums.join(' ')
          : [...nums.map((n) => n.padStart(pick.length > 1 ? 7 : 1)), r.name]
              .filter(Boolean)
              .join(' ');
      }),
    ),
  );
};

const grep: CommandFn = (ctx) => {
  const { flags, values, rest } = getopt(ctx.args, 'e');
  const badOpt = unknownFlags(flags, 'ivncrlwEFoH', 'grep');
  if (badOpt) return badOpt;
  const pattern = values.get('e') ?? rest.shift();
  if (pattern === undefined) return fail('Usage: grep [OPTION]... PATTERNS [FILE]...', 2);
  let re: RegExp;
  try {
    const src = flags.has('F')
      ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : pattern.replace(/\\([|(){}+?])/g, '$1');
    re = new RegExp(flags.has('w') ? `\\b(?:${src})\\b` : src, flags.has('i') ? 'gi' : 'g');
  } catch {
    return fail('grep: invalid regular expression', 2);
  }
  let files = rest;
  if (flags.has('r') && files.length === 0) files = ['.'];
  if (flags.has('r')) {
    files = files.flatMap((f) => {
      try {
        return ctx.shell.fs
          .walk(ctx.shell.abs(f), ctx.shell.user)
          .filter((e) => e.node.type === 'file')
          .map((e) =>
            f === '.'
              ? e.path.replace(`${ctx.shell.cwd}/`, '')
              : `${f}/${e.path.slice(ctx.shell.abs(f).length + 1)}`,
          );
      } catch {
        return [f];
      }
    });
  }
  const ins = inputs(ctx, files);
  if (!Array.isArray(ins)) return ins;
  const showName = flags.has('H') || ins.length > 1;
  const out: string[] = [];
  let any = false;
  for (const i of ins) {
    let count = 0;
    lines(i.text).forEach((line, idx) => {
      re.lastIndex = 0;
      const hit = re.test(line) !== flags.has('v');
      if (!hit) return;
      count++;
      any = true;
      if (flags.has('c') || flags.has('l')) return;
      re.lastIndex = 0;
      const shown = flags.has('o')
        ? (line.match(re) ?? []).join('\n')
        : ctx.tty && !flags.has('v')
          ? line.replace(re, (m) => color(m, '1;31', true))
          : line;
      out.push(
        `${showName ? `${color(i.name, '35', ctx.tty)}:` : ''}${flags.has('n') ? `${color(String(idx + 1), '32', ctx.tty)}:` : ''}${shown}`,
      );
    });
    if (flags.has('c')) out.push(`${showName ? `${i.name}:` : ''}${count}`);
    if (flags.has('l') && count > 0) out.push(i.name || '(standard input)');
  }
  return { out: joinLines(out), err: '', code: any ? 0 : 1 };
};

const sort: CommandFn = (ctx) => {
  const { flags, values, rest } = getopt(ctx.args, 'kt');
  const ins = inputs(ctx, rest);
  if (!Array.isArray(ins)) return ins;
  let ls = ins.flatMap((i) => lines(i.text));
  const sep = values.get('t');
  const k = values.get('k') ? Number(values.get('k')?.split(',')[0]) : null;
  const key = (l: string) => (k ? ((sep ? l.split(sep) : l.trim().split(/\s+/))[k - 1] ?? '') : l);
  const cmp = flags.has('n')
    ? (a: string, b: string) =>
        (parseFloat(key(a)) || 0) - (parseFloat(key(b)) || 0) || a.localeCompare(b)
    : (a: string, b: string) => key(a).localeCompare(key(b), 'en') || (a < b ? -1 : a > b ? 1 : 0);
  ls.sort(cmp);
  if (flags.has('r')) ls.reverse();
  if (flags.has('u')) ls = ls.filter((l, i) => i === 0 || cmp(l, ls[i - 1] as string) !== 0);
  return ok(joinLines(ls));
};

const uniq: CommandFn = (ctx) => {
  const { flags, rest } = getopt(ctx.args);
  const ins = inputs(ctx, rest.slice(0, 1));
  if (!Array.isArray(ins)) return ins;
  const groups: { line: string; n: number }[] = [];
  for (const l of lines(ins[0]?.text ?? '')) {
    const last = groups[groups.length - 1];
    if (last && last.line === l) last.n++;
    else groups.push({ line: l, n: 1 });
  }
  const kept = groups.filter((g) => (flags.has('d') ? g.n > 1 : flags.has('u') ? g.n === 1 : true));
  return ok(
    joinLines(kept.map((g) => (flags.has('c') ? `${String(g.n).padStart(7)} ${g.line}` : g.line))),
  );
};

function parseFieldList(list: string): (n: number) => boolean {
  const ranges = list.split(',').map((r) => {
    const [a, b] = r.split('-');
    const lo = a ? Number(a) : 1;
    const hi = b === undefined ? lo : b === '' ? Infinity : Number(b);
    return [lo, hi] as const;
  });
  return (n) => ranges.some(([lo, hi]) => n >= lo && n <= hi);
}

const cut: CommandFn = (ctx) => {
  const { values, rest } = getopt(ctx.args, 'dfc');
  const ins = inputs(ctx, rest);
  if (!Array.isArray(ins)) return ins;
  const f = values.get('f');
  const c = values.get('c');
  if (!f && !c) return fail('cut: you must specify a list of bytes, characters, or fields');
  const d = values.get('d') ?? '\t';
  const want = parseFieldList((f ?? c) as string);
  return ok(
    joinLines(
      ins
        .flatMap((i) => lines(i.text))
        .map((l) =>
          f
            ? l.includes(d)
              ? l
                  .split(d)
                  .filter((_, i) => want(i + 1))
                  .join(d)
              : l
            : [...l].filter((_, i) => want(i + 1)).join(''),
        ),
    ),
  );
};

function expandSet(s: string): string {
  const classes: Record<string, string> = {
    '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
    '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '[:digit:]': '0123456789',
    '[:space:]': ' \t\n',
  };
  let t = s;
  for (const [k, v] of Object.entries(classes)) t = t.split(k).join(v);
  t = t.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return t.replace(/(.)-(.)/g, (_, a: string, b: string) => {
    let r = '';
    for (let x = a.charCodeAt(0); x <= b.charCodeAt(0); x++) r += String.fromCharCode(x);
    return r;
  });
}

const tr: CommandFn = (ctx) => {
  const { flags, rest } = getopt(ctx.args);
  const set1 = expandSet(rest[0] ?? '');
  if (!rest[0]) return fail('tr: missing operand');
  if (flags.has('d')) return ok([...ctx.stdin].filter((ch) => !set1.includes(ch)).join(''));
  const set2 = expandSet(rest[1] ?? '');
  if (!set2) return fail(`tr: missing operand after '${rest[0]}'`);
  let out = [...ctx.stdin].map((ch) => {
    const i = set1.indexOf(ch);
    return i < 0 ? ch : (set2[Math.min(i, set2.length - 1)] as string);
  });
  if (flags.has('s'))
    out = out.filter((ch, i) => !(i > 0 && ch === out[i - 1] && set2.includes(ch)));
  return ok(out.join(''));
};

const tee: CommandFn = (ctx) => {
  const { flags, rest } = getopt(ctx.args);
  for (const f of rest) {
    try {
      ctx.shell.fs.write(
        ctx.shell.abs(f),
        ctx.stdin,
        ctx.shell.user,
        ctx.shell.umask,
        flags.has('a'),
      );
    } catch (e) {
      return { ...ctx.shell.fsError('tee', e, f), out: ctx.stdin };
    }
  }
  return ok(ctx.stdin);
};

const echo: CommandFn = ({ args }) => {
  let i = 0;
  let newline = true;
  let escapes = false;
  while (/^-[neE]+$/.test(args[i] ?? '')) {
    const a = args[i] as string;
    if (a.includes('n')) newline = false;
    if (a.includes('e')) escapes = true;
    if (a.includes('E')) escapes = false;
    i++;
  }
  let text = args.slice(i).join(' ');
  if (escapes) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  return ok(newline ? `${text}\n` : text);
};

const printf: CommandFn = ({ args }) => {
  const [fmt, ...vals] = args;
  if (fmt === undefined) return fail('printf: usage: printf format [arguments]');
  let out = '';
  let k = 0;
  do {
    out += fmt
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(
        /%(-?\d*)(?:\.(\d+))?([sdif%])/g,
        (_, w: string, p: string | undefined, c: string) => {
          if (c === '%') return '%';
          const v = vals[k++] ?? '';
          let s =
            c === 's'
              ? v
              : c === 'f'
                ? (Number(v) || 0).toFixed(p ? Number(p) : 6)
                : String(Math.trunc(Number(v) || 0));
          const width = Number(w.replace('-', '')) || 0;
          s = w.startsWith('-') ? s.padEnd(width) : s.padStart(width);
          return s;
        },
      );
  } while (k > 0 && k < vals.length);
  return ok(out);
};

const seq: CommandFn = ({ args }) => {
  const nums = args.map(Number);
  if (nums.length === 0 || nums.some(Number.isNaN)) return fail('seq: missing or invalid operand');
  const [first, step, last] =
    nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
  const out: string[] = [];
  for (
    let x = first as number;
    (step as number) > 0 ? x <= (last as number) : x >= (last as number);
    x += step as number
  ) {
    out.push(String(x));
    if (out.length > 10000) break;
  }
  return ok(joinLines(out));
};

const diff: CommandFn = (ctx) => {
  const ins = inputs(ctx, ctx.args.slice(0, 2));
  if (!Array.isArray(ins)) return ins;
  if (ctx.args.length < 2) return fail('diff: missing operand', 2);
  const a = lines(ins[0]?.text ?? '');
  const b = lines(ins[1]?.text ?? '');
  // Longest common subsequence, printed in the classic "3c3 / < old / --- / > new" style.
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      (dp[i] as number[])[j] =
        a[i] === b[j]
          ? ((dp[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((dp[i + 1] as number[])[j] as number, (dp[i] as number[])[j + 1] as number);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const i0 = i;
    const j0 = j;
    while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && a[i] === b[j])) {
      if (
        j >= b.length ||
        (i < a.length &&
          ((dp[i + 1] as number[])[j] as number) >= ((dp[i] as number[])[j + 1] as number))
      )
        i++;
      else j++;
    }
    const range = (s: number, e: number) => (e - s <= 1 ? String(s + 1) : `${s + 1},${e}`);
    const op = i0 === i ? 'a' : j0 === j ? 'd' : 'c';
    out.push(`${op === 'a' ? i0 : range(i0, i)}${op}${op === 'd' ? j0 : range(j0, j)}`);
    out.push(...a.slice(i0, i).map((l) => `< ${l}`));
    if (op === 'c') out.push('---');
    out.push(...b.slice(j0, j).map((l) => `> ${l}`));
  }
  return { out: joinLines(out), err: '', code: out.length ? 1 : 0 };
};

const find: CommandFn = ({ shell, args }) => {
  const start: string[] = [];
  let i = 0;
  while (i < args.length && !(args[i] as string).startsWith('-')) start.push(args[i++] as string);
  if (start.length === 0) start.push('.');
  const tests: ((p: string, n: Inode, depth: number) => boolean)[] = [];
  let maxDepth = Infinity;
  while (i < args.length) {
    const opt = args[i++] as string;
    const val = args[i++];
    if (val === undefined) return fail(`find: missing argument to '${opt}'`);
    if (opt === '-name' || opt === '-iname') {
      const re = new RegExp(
        `^${val
          .replace(/[.+^${}()|\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        opt === '-iname' ? 'i' : '',
      );
      tests.push((p) => re.test(basename(p)));
    } else if (opt === '-type')
      tests.push((_, n) => (val === 'd' ? n.type === 'dir' : n.type === 'file'));
    else if (opt === '-maxdepth') maxDepth = Number(val);
    else if (opt === '-user') tests.push((_, n) => n.owner === val);
    else if (opt === '-perm')
      tests.push((_, n) => octal(n.mode) === val.replace(/^0/, '').padStart(3, '0'));
    else if (opt === '-size') {
      const m = /^([+-]?)(\d+)([ck]?)$/.exec(val);
      if (!m) return fail(`find: invalid argument '${val}' to '-size'`);
      const unit = m[3] === 'k' ? 1024 : m[3] === 'c' ? 1 : 512;
      const lim = Number(m[2]) * unit;
      tests.push((_, n) =>
        m[1] === '+' ? sizeOf(n) > lim : m[1] === '-' ? sizeOf(n) < lim : sizeOf(n) === lim,
      );
    } else return fail(`find: unknown predicate '${opt}'`);
  }
  const out: string[] = [];
  let err = '';
  for (const s of start) {
    let entries;
    try {
      entries = shell.fs.walk(shell.abs(s), shell.user);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `find: '${s}': ${errorText(e)}\n`;
      continue;
    }
    const base = shell.abs(s);
    for (const e of entries) {
      if (e.depth > maxDepth) continue;
      const shown =
        e.path === base
          ? s
          : `${s === '/' ? '' : s.replace(/\/$/, '')}/${e.path.slice(base === '/' ? 1 : base.length + 1)}`;
      if (tests.every((t) => t(e.path, e.node, e.depth))) out.push(shown);
      if (
        e.node.type === 'dir' &&
        (!can(e.node, shell.user, 'r') || !can(e.node, shell.user, 'x')) &&
        e.depth < maxDepth
      ) {
        err += `find: '${shown}': Permission denied\n`;
      }
    }
  }
  return { out: joinLines(out), err, code: err ? 1 : 0 };
};

const tree: CommandFn = (ctx) => {
  const { shell } = ctx;
  const { flags, rest } = getopt(ctx.args);
  const root = rest[0] ?? '.';
  let top: Inode;
  try {
    top = shell.fs.lookup(shell.abs(root), shell.user);
  } catch (e) {
    return shell.fsError('tree', e, root);
  }
  const out = [colourName(root, top, ctx.tty)];
  let dirs = 0;
  let files = 0;
  const rec = (node: Inode, prefix: string) => {
    if (!can(node, shell.user, 'r') || !can(node, shell.user, 'x')) return;
    const kids = [...node.children]
      .filter(([n]) => flags.has('a') || !n.startsWith('.'))
      .sort(([a], [b]) => a.localeCompare(b));
    kids.forEach(([name, child], i) => {
      const last = i === kids.length - 1;
      out.push(`${prefix}${last ? '└── ' : '├── '}${colourName(name, child, ctx.tty)}`);
      if (child.type === 'dir') {
        dirs++;
        rec(child, prefix + (last ? '    ' : '│   '));
      } else files++;
    });
  };
  if (top.type === 'dir') rec(top, '');
  out.push(
    '',
    `${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`,
  );
  return ok(joinLines(out));
};

// ---- Permissions and users ----

/** Applies one chmod mode ("755", "u+x", "go-w,a+r") to a mode number. */
export function applyChmod(mode: number, spec: string, isDir: boolean, umask = 0): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return (mode & ~0o7777) | parseInt(spec, 8);
  let m = mode;
  for (const clause of spec.split(',')) {
    const c = /^([ugoa]*)([+\-=])([rwxXst]*)$/.exec(clause);
    if (!c) return null;
    const who = c[1] || 'a';
    const useUmask = !c[1];
    let bits = 0;
    for (const p of c[3] as string) {
      if (p === 'r') bits |= 0o444;
      if (p === 'w') bits |= 0o222;
      if (p === 'x' || (p === 'X' && (isDir || (mode & 0o111) !== 0))) bits |= 0o111;
      if (p === 's') bits |= 0o6000;
      if (p === 't') bits |= 0o1000;
    }
    let mask = 0;
    if (who.includes('u') || who.includes('a')) mask |= 0o4700;
    if (who.includes('g') || who.includes('a')) mask |= 0o2070;
    if (who.includes('o') || who.includes('a')) mask |= 0o1007;
    let change = bits & mask;
    if (useUmask && c[2] === '+') change &= ~umask;
    if (c[2] === '+') m |= change;
    else if (c[2] === '-') m &= ~change;
    else m = (m & ~(mask & 0o777)) | change;
  }
  return m;
}

const chmod: CommandFn = ({ shell, args }) => {
  // "-R" is the only option; "-w" / "-x" / "-rwx" are modes (remove those bits).
  const recursive = args.includes('-R');
  const operands = args.filter((a) => a !== '-R');
  const [modeArg, ...files] = operands;
  if (!modeArg || files.length === 0) {
    return fail(modeArg ? `chmod: missing operand after '${modeArg}'` : 'chmod: missing operand');
  }
  let err = '';
  const apply = (path: string, shown: string) => {
    const node = shell.fs.lookup(path, shell.user);
    if (shell.user.uid !== 0 && node.owner !== shell.user.name) throw new FsError('EPERM', shown);
    const next = applyChmod(node.mode, modeArg, node.type === 'dir', shell.umask);
    if (next === null) throw new Error(`chmod: invalid mode: '${modeArg}'`);
    node.mode = next;
    node.mtime = shell.fs.now;
    if (recursive && node.type === 'dir')
      for (const [c] of node.children) apply(`${path}/${c}`, `${shown}/${c}`);
  };
  for (const f of files) {
    try {
      apply(shell.abs(f), f);
    } catch (e) {
      if (e instanceof FsError)
        err += `chmod: changing permissions of '${f}': ${e.code === 'EPERM' ? 'Operation not permitted' : errorText(e)}\n`;
      else if (e instanceof Error) return fail(e.message);
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

const chown: CommandFn = ({ shell, args, name }) => {
  const { flags, rest } = getopt(args);
  const [spec, ...files] = rest;
  if (!spec || files.length === 0) return fail(`${name}: missing operand`);
  const [owner, group] =
    name === 'chgrp' ? [undefined, spec] : (spec.split(':') as [string, string | undefined]);
  const users = ['root', 'student'];
  const groups = ['root', 'student', 'lab'];
  if (owner && !users.includes(owner)) return fail(`chown: invalid user: '${spec}'`);
  if (group && !groups.includes(group)) return fail(`${name}: invalid group: '${spec}'`);
  let err = '';
  const apply = (path: string, shown: string) => {
    const node = shell.fs.lookup(path, shell.user);
    const isRoot = shell.user.uid === 0;
    // Only root may give a file away; an owner may change its group to one of their groups.
    if (!isRoot && owner !== undefined && owner !== node.owner) throw new FsError('EPERM', shown);
    if (
      !isRoot &&
      (node.owner !== shell.user.name || (group && !shell.user.groups.includes(group)))
    )
      throw new FsError('EPERM', shown);
    if (owner) node.owner = owner;
    if (group) node.group = group;
    if (flags.has('R') && node.type === 'dir')
      for (const [c] of node.children) apply(`${path}/${c}`, `${shown}/${c}`);
  };
  for (const f of files) {
    try {
      apply(shell.abs(f), f);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      err += `${name}: changing ownership of '${f}': ${e.code === 'EPERM' ? 'Operation not permitted' : errorText(e)}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
};

const umask: CommandFn = ({ shell, args }) => {
  if (args[0] === '-S') {
    const p = (shift: number) =>
      ['r', 'w', 'x'].filter((_, i) => !((shell.umask >> shift) & (4 >> i))).join('');
    return ok(`u=${p(6)},g=${p(3)},o=${p(0)}\n`);
  }
  if (args[0] === undefined) return ok(`${shell.umask.toString(8).padStart(4, '0')}\n`);
  if (!/^[0-7]{1,4}$/.test(args[0]))
    return fail(`bash: umask: ${args[0]}: octal number out of range`);
  shell.umask = parseInt(args[0], 8) & 0o777;
  return ok();
};

const stat: CommandFn = ({ shell, args }) => {
  if (args.length === 0) return fail('stat: missing operand');
  const out: string[] = [];
  for (const f of args) {
    try {
      const n = shell.fs.lookup(shell.abs(f), shell.user);
      out.push(
        `  File: ${f}`,
        `  Size: ${sizeOf(n)}\t\t${n.type === 'dir' ? 'directory' : 'regular file'}`,
        `Access: (${(n.mode & 0o7777).toString(8).padStart(4, '0')}/${modeString(n)})  Uid: (${n.owner === 'root' ? 0 : 1000}/${n.owner.padStart(8)})   Gid: (${n.group === 'root' ? 0 : n.group === 'lab' ? 1001 : 1000}/${n.group.padStart(8)})`,
        `Modify: ${new Date(n.mtime * 1000).toISOString().replace('T', ' ').replace('.000Z', ' +0000')}`,
      );
    } catch (e) {
      return shell.fsError('stat', e, `cannot statx '${f}'`);
    }
  }
  return ok(joinLines(out));
};

const file: CommandFn = ({ shell, args }) => {
  const out: string[] = [];
  for (const f of args) {
    try {
      const n = shell.fs.lookup(shell.abs(f), shell.user);
      const kind =
        n.type === 'dir'
          ? 'directory'
          : n.content === ''
            ? 'empty'
            : n.content.startsWith('#!')
              ? `${n.content.slice(2).split('\n')[0]?.trim()} script, ASCII text executable`
              : 'ASCII text';
      out.push(`${f}: ${kind}`);
    } catch (e) {
      out.push(`${f}: cannot open \`${f}' (${e instanceof FsError ? errorText(e) : 'error'})`);
    }
  }
  return ok(joinLines(out));
};

const whoami: CommandFn = ({ shell }) => ok(`${shell.user.name}\n`);
const id: CommandFn = ({ shell }) => {
  const u = shell.user;
  const gid = (g: string) => (g === 'root' ? 0 : g === 'lab' ? 1001 : 1000);
  return ok(
    `uid=${u.uid}(${u.name}) gid=${gid(u.groups[0] as string)}(${u.groups[0]}) groups=${u.groups.map((g) => `${gid(g)}(${g})`).join(',')}\n`,
  );
};
const groupsCmd: CommandFn = ({ shell }) => ok(`${shell.user.groups.join(' ')}\n`);

const sudo: CommandFn = ({ shell, args, stdin, tty }) => {
  if (args.length === 0) return fail('usage: sudo command');
  if (args[0] === '-i' || args[0] === '-s' || (args[0] === 'su' && args.length === 1)) {
    shell.becomeRoot();
    shell.cwd = '/root';
    return ok();
  }
  shell.users.push(ROOT);
  try {
    return shell.exec(args, stdin, tty);
  } finally {
    shell.users.pop();
  }
};

const su: CommandFn = ({ shell, args }) => {
  const who = args.filter((a) => a !== '-')[0] ?? 'root';
  if (who === 'student') {
    if (shell.users.length > 1) shell.users.pop();
    return ok();
  }
  if (who !== 'root') return fail(`su: user ${who} does not exist`);
  if (shell.user.uid !== 0)
    return fail(
      "su: Authentication failure\n(This lab machine has no root password. Use 'sudo -i' or 'sudo <command>'.)",
    );
  return ok();
};

const exit: CommandFn = ({ shell, args }) => {
  const code = Number(args[0] ?? shell.lastCode) || 0;
  if (shell.depth > 0) throw new ExitSignal(code);
  if (shell.users.length > 1) {
    shell.users.pop();
    shell.cwd = shell.home;
    return ok('logout\n');
  }
  return ok('logout\n(The simulator keeps this terminal open. Press Reset to start over.)\n');
};

// ---- Processes ----

function fmtTime(t: number) {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const ps: CommandFn = ({ shell, args }) => {
  const all = args.some(
    (a) => /^-?[a-zA-Z]*[eA]/.test(a) || a === 'aux' || a === '-aux' || a === 'ax',
  );
  const full = args.some((a) => /f/.test(a) || /u/.test(a));
  const self = {
    pid: shell.nextPid++,
    ppid: shell.shellPid,
    user: shell.user.name,
    cmd: `ps ${args.join(' ')}`.trim(),
    start: shell.fs.now,
    end: null,
    job: null,
    tty: 'pts/0',
  };
  const procs = [...shell.procs, self].filter((p) => all || p.tty === 'pts/0');
  if (full) {
    const rows = procs.map(
      (p) =>
        `${p.user.padEnd(8)} ${String(p.pid).padStart(5)} ${String(p.ppid).padStart(5)}  0 ${fmtTime(p.start)} ${p.tty.padEnd(8)} 00:00:00 ${p.cmd}`,
    );
    return ok(joinLines(['UID        PID  PPID  C STIME TTY          TIME CMD', ...rows]));
  }
  const rows = procs.map(
    (p) =>
      `${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:00:00 ${p.cmd.split(' ')[0]?.replace(/^.*\//, '')}`,
  );
  return ok(joinLines(['    PID TTY          TIME CMD', ...rows]));
};

const SIGNALS: Record<string, number> = { HUP: 1, INT: 2, KILL: 9, TERM: 15, STOP: 19, CONT: 18 };

const kill: CommandFn = ({ shell, args }) => {
  if (args[0] === '-l')
    return ok(
      `${Object.entries(SIGNALS)
        .map(([n, v]) => `${v}) SIG${n}`)
        .join(' ')}\n`,
    );
  let sig = 15;
  const targets: string[] = [];
  for (const a of args) {
    const m = /^-(?:SIG)?([A-Z]+|\d+)$/.exec(a);
    if (m) sig = /^\d+$/.test(m[1] as string) ? Number(m[1]) : (SIGNALS[m[1] as string] ?? -1);
    else if (a === '-s') continue;
    else targets.push(a);
  }
  if (sig < 0) return fail('kill: invalid signal specification');
  if (targets.length === 0) return fail('kill: usage: kill [-s sigspec | -signum] pid | %job');
  let err = '';
  for (const t of targets) {
    const proc = t.startsWith('%')
      ? shell.procs.find((p) => p.job === Number(t.slice(1)))
      : shell.procs.find((p) => p.pid === Number(t));
    if (!proc) {
      err += `bash: kill: ${t}: ${t.startsWith('%') ? 'no such job' : 'No such process'}\n`;
      continue;
    }
    if (shell.user.uid !== 0 && proc.user !== shell.user.name) {
      err += `bash: kill: (${proc.pid}) - Operation not permitted\n`;
      continue;
    }
    if (proc.pid === shell.shellPid) {
      err += 'bash: kill: refusing to kill this terminal (it is the simulator)\n';
      continue;
    }
    if (sig === 0 || sig === 18 || sig === 19) continue;
    shell.procs = shell.procs.filter((p) => p !== proc);
    if (proc.job !== null)
      shell.notices.push(
        `[${proc.job}]+  ${sig === 9 ? 'Killed' : 'Terminated'}              ${proc.cmd}`,
      );
  }
  return { out: '', err, code: err ? 1 : 0 };
};

const jobs: CommandFn = ({ shell, args }) => {
  const list = shell.procs.filter((p) => p.job !== null);
  return ok(
    joinLines(
      list.map(
        (p, i) =>
          `[${p.job}]${i === list.length - 1 ? '+' : '-'}  ${args.includes('-l') ? `${p.pid} ` : ''}Running                 ${p.cmd} &`,
      ),
    ),
  );
};

const waitCmd: CommandFn = ({ shell, args }) => {
  const list = shell.procs.filter(
    (p) =>
      p.job !== null &&
      (args.length === 0 || args.includes(String(p.pid)) || args.includes(`%${p.job}`)),
  );
  const end = Math.max(shell.fs.now, ...list.map((p) => p.end ?? shell.fs.now));
  shell.fs.now = end;
  shell.reapJobs();
  return ok();
};

const fg: CommandFn = ({ shell, args }) => {
  const list = shell.procs.filter((p) => p.job !== null);
  const proc = args[0]
    ? list.find((p) => `%${p.job}` === args[0] || String(p.job) === args[0])
    : list[list.length - 1];
  if (!proc) return fail('bash: fg: current: no such job');
  shell.fs.now = Math.max(shell.fs.now, proc.end ?? shell.fs.now);
  shell.procs = shell.procs.filter((p) => p !== proc);
  return ok(`${proc.cmd}\n`);
};

const sleep: CommandFn = ({ shell, args }) => {
  const s = parseDuration(args[0] ?? '');
  if (s === null) return fail(`sleep: invalid time interval '${args[0] ?? ''}'`);
  // The virtual clock jumps ahead instead of making students wait.
  shell.fs.now += s;
  shell.reapJobs();
  return ok();
};

// ---- Shell builtins ----

const exportCmd: CommandFn = ({ shell, args }) => {
  if (args.length === 0 || args[0] === '-p') {
    return ok(
      joinLines([...shell.exported].sort().map((n) => `declare -x ${n}="${shell.getVar(n)}"`)),
    );
  }
  for (const a of args) {
    const m = /^([A-Za-z_]\w*)(?:=(.*))?$/.exec(a);
    if (!m) return fail(`bash: export: \`${a}': not a valid identifier`);
    if (m[2] !== undefined) shell.vars.set(m[1] as string, m[2]);
    shell.exported.add(m[1] as string);
  }
  return ok();
};

const unset: CommandFn = ({ shell, args }) => {
  for (const a of args) {
    shell.vars.delete(a);
    shell.exported.delete(a);
  }
  return ok();
};

const env: CommandFn = ({ shell }) =>
  ok(
    joinLines(
      [...new Set([...shell.exported, 'PWD', 'HOME', 'USER'])]
        .sort()
        .map((n) => `${n}=${shell.getVar(n)}`),
    ),
  );

const alias: CommandFn = ({ shell, args }) => {
  if (args.length === 0)
    return ok(joinLines([...shell.aliases].map(([k, v]) => `alias ${k}='${v}'`)));
  for (const a of args) {
    const m = /^([\w.-]+)=(.*)$/.exec(a);
    if (m) shell.aliases.set(m[1] as string, m[2] as string);
    else if (shell.aliases.has(a)) return ok(`alias ${a}='${shell.aliases.get(a)}'\n`);
    else return fail(`bash: alias: ${a}: not found`);
  }
  return ok();
};

const unalias: CommandFn = ({ shell, args }) => {
  for (const a of args) shell.aliases.delete(a);
  return ok();
};

const history: CommandFn = ({ shell, args }) => {
  if (args[0] === '-c') {
    shell.history = [];
    return ok();
  }
  const cmds = shell.history.filter((h): h is string => typeof h === 'string');
  return ok(joinLines(cmds.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`)));
};

const which: CommandFn = ({ args }) => {
  const out = args.filter((a) => COMMANDS[a] && !BUILTINS.has(a)).map((a) => `/usr/bin/${a}`);
  return { out: joinLines(out), err: '', code: out.length === args.length ? 0 : 1 };
};

const type: CommandFn = ({ shell, args }) =>
  ok(
    joinLines(
      args.map((a) =>
        shell.aliases.has(a)
          ? `${a} is aliased to \`${shell.aliases.get(a)}'`
          : BUILTINS.has(a)
            ? `${a} is a shell builtin`
            : COMMANDS[a]
              ? `${a} is /usr/bin/${a}`
              : `bash: type: ${a}: not found`,
      ),
    ),
  );

const test: CommandFn = ({ shell, args, name }) => {
  let a = args;
  if (name === '[') {
    if (a[a.length - 1] !== ']') return fail("bash: [: missing `]'", 2);
    a = a.slice(0, -1);
  }
  const node = (p: string) => {
    try {
      return shell.fs.lookup(shell.abs(p), shell.user);
    } catch {
      return null;
    }
  };
  const evalTest = (t: string[]): boolean => {
    if (t[0] === '!') return !evalTest(t.slice(1));
    if (t.length === 0) return false;
    if (t.length === 1) return (t[0] as string) !== '';
    if (t.length === 2) {
      const [op, v] = t as [string, string];
      const n = node(v);
      switch (op) {
        case '-e':
          return n !== null;
        case '-f':
          return n?.type === 'file';
        case '-d':
          return n?.type === 'dir';
        case '-r':
          return !!n && can(n, shell.user, 'r');
        case '-w':
          return !!n && can(n, shell.user, 'w');
        case '-x':
          return !!n && can(n, shell.user, 'x');
        case '-s':
          return !!n && n.content.length > 0;
        case '-z':
          return v === '';
        case '-n':
          return v !== '';
        default:
          return false;
      }
    }
    const [l, op, r] = t as [string, string, string];
    const nl = Number(l);
    const nr = Number(r);
    switch (op) {
      case '=':
      case '==':
        return l === r;
      case '!=':
        return l !== r;
      case '-eq':
        return nl === nr;
      case '-ne':
        return nl !== nr;
      case '-lt':
        return nl < nr;
      case '-le':
        return nl <= nr;
      case '-gt':
        return nl > nr;
      case '-ge':
        return nl >= nr;
      default:
        return false;
    }
  };
  const andIdx = a.indexOf('-a');
  const orIdx = a.indexOf('-o');
  const result =
    orIdx > 0
      ? evalTest(a.slice(0, orIdx)) || evalTest(a.slice(orIdx + 1))
      : andIdx > 0
        ? evalTest(a.slice(0, andIdx)) && evalTest(a.slice(andIdx + 1))
        : evalTest(a);
  return { out: '', err: '', code: result ? 0 : 1 };
};

const read: CommandFn = ({ shell, args, stdin }) => {
  const names = args.filter((a) => !a.startsWith('-'));
  const line = stdin.split('\n')[0] ?? '';
  const parts = line.trim().split(/\s+/);
  names.forEach((n, i) =>
    shell.vars.set(n, i === names.length - 1 ? parts.slice(i).join(' ') : (parts[i] ?? '')),
  );
  return { out: '', err: '', code: stdin ? 0 : 1 };
};

const source: CommandFn = ({ shell, args }) => {
  if (!args[0]) return fail('bash: source: filename argument required');
  return shell.runScriptFile(args[0], args.slice(1), false);
};

const bash: CommandFn = ({ shell, args }) => {
  if (args[0] === '-c') return shell.run(args[1] ?? '');
  if (!args[0])
    return fail(
      'bash: an interactive sub-shell is not available here. Run a script: bash script.sh',
    );
  return shell.runScriptFile(args[0], args.slice(1), false);
};

const editor: CommandFn = ({ shell, args, name }) => {
  const path = args.filter((a) => !a.startsWith('-'))[0];
  if (!path) return fail(`${name}: give a file name, e.g. ${name} notes.txt`);
  const abs = shell.abs(path);
  let content = '';
  let writable = true;
  try {
    const node = shell.fs.lookup(abs, shell.user);
    if (node.type === 'dir') return fail(`${name}: ${path}: Is a directory`);
    if (!can(node, shell.user, 'r')) return fail(`${name}: ${path}: Permission denied`);
    content = node.content;
    writable = can(node, shell.user, 'w');
  } catch (e) {
    if (!(e instanceof FsError) || e.code !== 'ENOENT') return shell.fsError(name, e, path);
    try {
      const parent = shell.fs.lookup(shell.dirOf(abs), shell.user);
      writable = can(parent, shell.user, 'w') && can(parent, shell.user, 'x');
    } catch (e2) {
      return shell.fsError(name, e2, path);
    }
  }
  shell.effects.editor = { path: abs, content, writable };
  return ok();
};

const clear: CommandFn = ({ shell }) => {
  shell.effects.clear = true;
  return ok();
};

const date: CommandFn = ({ shell, args }) => {
  const d = new Date(shell.fs.now * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = args.find((a) => a.startsWith('+'));
  if (fmt) {
    return ok(
      `${fmt
        .slice(1)
        .replace(/%Y/g, String(d.getUTCFullYear()))
        .replace(/%m/g, pad(d.getUTCMonth() + 1))
        .replace(/%d/g, pad(d.getUTCDate()))
        .replace(/%H/g, pad(d.getUTCHours()))
        .replace(/%M/g, pad(d.getUTCMinutes()))
        .replace(/%S/g, pad(d.getUTCSeconds()))
        .replace(/%s/g, String(shell.fs.now))}\n`,
    );
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return ok(
    `${days[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}\n`,
  );
};

const uname: CommandFn = ({ args }) =>
  ok(
    args.includes('-a')
      ? 'Linux cslab 6.8.0-cslab #1 SMP x86_64 GNU/Linux\n'
      : args.includes('-r')
        ? '6.8.0-cslab\n'
        : 'Linux\n',
  );

const hostname: CommandFn = () => ok('cslab\n');
const df: CommandFn = () =>
  ok(
    'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        20G  6.1G   13G  32% /\ntmpfs           2.0G     0  2.0G   0% /tmp\n',
  );
const free: CommandFn = () =>
  ok(
    '               total        used        free      shared  buff/cache   available\nMem:           3.8Gi       1.1Gi       1.9Gi        12Mi       820Mi       2.5Gi\nSwap:          2.0Gi          0B       2.0Gi\n',
  );
const uptime: CommandFn = ({ shell }) =>
  ok(` ${fmtTime(shell.fs.now)}:00 up 1:00,  1 user,  load average: 0.08, 0.03, 0.01\n`);

const basenameCmd: CommandFn = ({ args }) =>
  ok(
    `${basename(args[0] ?? '').replace(new RegExp(`${(args[1] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '')}\n`,
  );
const dirnameCmd: CommandFn = ({ args }) => {
  const p = args[0] ?? '.';
  const i = p.replace(/\/$/, '').lastIndexOf('/');
  return ok(`${i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i)}\n`);
};

const trueCmd: CommandFn = () => ok();
const falseCmd: CommandFn = () => ({ out: '', err: '', code: 1 });

export const MANUAL: Record<string, string> = {
  pwd: 'pwd - print the current directory',
  cd: 'cd [dir] - change directory (cd, cd ~, cd .., cd -)',
  ls: 'ls [-l -a -h -R -t -S -r -d] [path...] - list files',
  mkdir: 'mkdir [-p] dir... - make directories (-p makes parents)',
  rmdir: 'rmdir dir... - remove empty directories',
  touch: 'touch file... - create empty files or update their time',
  rm: 'rm [-r -f] path... - remove files (-r for directories). There is no recycle bin.',
  cp: 'cp [-r] src... dest - copy files (-r for directories)',
  mv: 'mv src... dest - move or rename',
  cat: 'cat [-n] [file...] - print files (-n numbers lines)',
  head: 'head [-n N] [file...] - first N lines (default 10)',
  tail: 'tail [-n N] [file...] - last N lines (default 10)',
  wc: 'wc [-l -w -c] [file...] - count lines, words, bytes',
  grep: 'grep [-i -v -n -c -r -l -w -o] pattern [file...] - search for lines matching a pattern',
  sort: 'sort [-r -n -u -k N -t sep] [file...] - sort lines',
  uniq: 'uniq [-c -d -u] [file] - collapse repeated adjacent lines (sort first!)',
  cut: 'cut -d sep -f list | -c list [file...] - pick fields or characters',
  tr: "tr [-d -s] set1 [set2] - translate characters, e.g. tr 'a-z' 'A-Z'",
  tee: 'tee [-a] file... - copy stdin to files and to stdout',
  echo: 'echo [-n -e] text... - print text',
  printf: "printf format [args...] - formatted output, e.g. printf '%s is %d\\n' Lea 20",
  find: 'find [path...] [-name pat -iname pat -type f|d -maxdepth N -user u -perm 755 -size +1k]',
  tree: 'tree [-a] [dir] - draw the directory tree',
  diff: 'diff file1 file2 - show line differences',
  chmod: 'chmod [-R] mode file... - change permissions: 755, 644, u+x, go-w, a=r',
  chown: 'chown [-R] user[:group] file... - change owner (root only)',
  chgrp: 'chgrp group file... - change group',
  umask: 'umask [-S] [mask] - default permissions removed from new files',
  stat: 'stat file... - permissions, owner, size and time of a file',
  file: 'file path... - guess what kind of file it is',
  whoami: 'whoami - print your user name',
  id: 'id - user and group ids',
  groups: 'groups - your groups',
  sudo: 'sudo command - run one command as root (sudo -i opens a root shell)',
  su: 'su [user] - switch user',
  ps: 'ps [-ef | aux] - list processes',
  kill: 'kill [-9 | -15] pid|%job - send a signal to a process',
  jobs: 'jobs [-l] - background jobs of this shell',
  fg: 'fg [%job] - wait for a background job (bring it to the foreground)',
  wait: 'wait - wait for all background jobs',
  sleep: 'sleep N - pause (the clock here jumps ahead instantly)',
  export: 'export NAME=value - set an environment variable',
  env: 'env - list environment variables',
  alias: "alias name='command' - define a shortcut",
  history: 'history - commands typed so far',
  which: 'which command - where a command lives',
  type: 'type name - builtin, alias or program?',
  test: 'test expr / [ expr ] - -f -d -e -r -w -x, = !=, -eq -lt -gt ...',
  read: 'read var... - read a line from stdin into variables',
  bash: 'bash script.sh [args] - run a script (needs only r permission)',
  source: 'source file - run a file in the current shell',
  nano: 'nano file - edit a file',
  clear: 'clear - clear the screen (also Ctrl+L)',
  date: 'date [+%Y-%m-%d] - current date and time',
  seq: 'seq [first [step]] last - print a sequence of numbers',
  uname: 'uname [-a] - system information',
  man: 'man command - short manual for a command',
  help: 'help - list every command',
  exit: 'exit [code] - leave a root shell or a script',
};

const man: CommandFn = ({ args }) => {
  if (!args[0]) return fail("What manual page do you want?\nFor example, try 'man ls'.");
  const page =
    MANUAL[args[0]] ??
    MANUAL[{ tail: 'tail', vi: 'nano', vim: 'nano', '[': 'test' }[args[0]] ?? ''];
  return page ? ok(`${page}\n`) : fail(`No manual entry for ${args[0]}`, 16);
};

const help: CommandFn = () =>
  ok(
    `Commands available in this simulator (try 'man <command>'):\n\n${Object.keys(MANUAL)
      .sort()
      .join(
        '  ',
      )}\n\nAlso: pipes |, redirection > >> < 2> &>, && || ; &, $VAR, $(cmd), globs * ?,\nif / for / while in scripts, and Tab to complete names.\n`,
  );

const BUILTINS = new Set([
  'cd',
  'pwd',
  'echo',
  'printf',
  'export',
  'unset',
  'alias',
  'unalias',
  'history',
  'type',
  'test',
  '[',
  'read',
  'source',
  '.',
  'exit',
  'jobs',
  'fg',
  'wait',
  'kill',
  'umask',
  'help',
  'true',
  'false',
]);

export const COMMANDS: Record<string, CommandFn> = {
  pwd,
  cd,
  ls,
  mkdir,
  rmdir,
  touch,
  rm,
  cp,
  mv,
  cat,
  less: cat,
  more: cat,
  head,
  tail: head,
  wc,
  grep,
  sort,
  uniq,
  cut,
  tr,
  tee,
  echo,
  printf,
  seq,
  diff,
  find,
  tree,
  chmod,
  chown,
  chgrp: chown,
  umask,
  stat,
  file,
  whoami,
  id,
  groups: groupsCmd,
  sudo,
  su,
  exit,
  logout: exit,
  ps,
  kill,
  jobs,
  wait: waitCmd,
  fg,
  sleep,
  export: exportCmd,
  unset,
  env,
  printenv: env,
  alias,
  unalias,
  history,
  which,
  type,
  test,
  '[': test,
  read,
  source,
  '.': source,
  bash,
  sh: bash,
  nano: editor,
  vi: editor,
  vim: editor,
  clear,
  date,
  uname,
  hostname,
  df,
  free,
  uptime,
  basename: basenameCmd,
  dirname: dirnameCmd,
  true: trueCmd,
  false: falseCmd,
  man,
  help,
};
