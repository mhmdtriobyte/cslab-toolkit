import { COMMANDS, type CommandFn } from './commands';
import {
  baseFileSystem,
  basename,
  can,
  dirname,
  errorText,
  FileSystem,
  FsError,
  resolvePath,
  ROOT,
  STUDENT,
  type User,
} from './fs';
import {
  evalArith,
  globPattern,
  globToRegExp,
  parse,
  ParseError,
  type ListItem,
  type SimpleCommand,
  type Word,
} from './parser';

export interface Result {
  out: string;
  err: string;
  code: number;
}

export const ok = (out = ''): Result => ({ out, err: '', code: 0 });
export const fail = (err: string, code = 1): Result => ({
  out: '',
  err: err.endsWith('\n') ? err : `${err}\n`,
  code,
});

export interface Proc {
  pid: number;
  ppid: number;
  user: string;
  cmd: string;
  /** Virtual time it started, and when it will finish (null = runs until killed). */
  start: number;
  end: number | null;
  /** Job number for background jobs of this shell. */
  job: number | null;
  tty: string;
}

export interface Ctx {
  shell: Shell;
  name: string;
  args: string[];
  stdin: string;
  /** stdout goes to the terminal (colours on, like a real tty). */
  tty: boolean;
}

/** Things the UI must do after a command: open the editor, clear the screen. */
export interface Effects {
  editor: { path: string; content: string; writable: boolean } | null;
  clear: boolean;
}

/** An editor save, recorded in the history so a shared link replays it. */
export interface EditorSave {
  path: string;
  content: string;
}

export type HistoryEntry = string | EditorSave;

/** Fixed start time (2026-11-17 09:00 UTC), so every replay prints the same dates. */
export const EPOCH = Date.UTC(2026, 10, 17, 9, 0, 0) / 1000;
const MAX_LOOP = 1000;
const MAX_DEPTH = 20;

export class ExitSignal extends Error {
  constructor(readonly code: number) {
    super('exit');
  }
}

export class Shell {
  fs: FileSystem;
  /** Logged-in user plus any su / sudo -i on top. */
  users: User[] = [STUDENT];
  cwd = '/home/student';
  oldPwd = '/home/student';
  vars = new Map<string, string>();
  exported = new Set<string>(['HOME', 'USER', 'PATH', 'SHELL', 'PWD', 'LANG']);
  aliases = new Map<string, string>([
    ['ll', 'ls -l'],
    ['la', 'ls -a'],
  ]);
  umask = 0o022;
  lastCode = 0;
  history: HistoryEntry[] = [];
  procs: Proc[];
  nextPid = 2401;
  nextJob = 1;
  /** Lines like "[1]+  Done  sleep 5" waiting to be printed before the next prompt. */
  notices: string[] = [];
  effects: Effects = { editor: null, clear: false };
  positional: string[] = [];
  depth = 0;
  /** Every command line typed and what it printed, for mission checks. */
  log: { line: string; out: string; err: string; code: number }[] = [];

  constructor(fs: FileSystem = baseFileSystem()) {
    this.fs = fs;
    fs.now = EPOCH;
    this.procs = [
      {
        pid: 1,
        ppid: 0,
        user: 'root',
        cmd: '/sbin/init',
        start: EPOCH - 3600,
        end: null,
        job: null,
        tty: '?',
      },
      {
        pid: 412,
        ppid: 1,
        user: 'root',
        cmd: '/usr/sbin/cron -f',
        start: EPOCH - 3590,
        end: null,
        job: null,
        tty: '?',
      },
      {
        pid: 520,
        ppid: 1,
        user: 'root',
        cmd: '/usr/sbin/sshd -D',
        start: EPOCH - 3590,
        end: null,
        job: null,
        tty: '?',
      },
      {
        pid: 2400,
        ppid: 1,
        user: 'student',
        cmd: '-bash',
        start: EPOCH,
        end: null,
        job: null,
        tty: 'pts/0',
      },
    ];
  }

  get user(): User {
    return this.users[this.users.length - 1] as User;
  }

  get home(): string {
    return this.user.uid === 0 ? '/root' : `/home/${this.user.name}`;
  }

  get shellPid(): number {
    return 2400;
  }

  getVar(name: string): string {
    switch (name) {
      case '?':
        return String(this.lastCode);
      case '$':
        return String(this.shellPid);
      case '#':
        return String(this.positional.length);
      case '@':
        return this.positional.join(' ');
      case '0':
        return 'bash';
      case 'HOME':
        return this.vars.get('HOME') ?? this.home;
      case 'USER':
        return this.user.name;
      case 'PWD':
        return this.cwd;
      case 'OLDPWD':
        return this.oldPwd;
      case 'SHELL':
        return '/bin/bash';
      case 'PATH':
        return this.vars.get('PATH') ?? '/usr/local/bin:/usr/bin:/bin';
      case 'LANG':
        return 'en_US.UTF-8';
      case 'HOSTNAME':
        return 'cslab';
      case 'RANDOM':
        return String((this.fs.now * 7919) % 32768);
      default:
        if (/^[1-9]$/.test(name)) return this.positional[Number(name) - 1] ?? '';
        return this.vars.get(name) ?? '';
    }
  }

  abs(path: string): string {
    return resolvePath(this.cwd, path);
  }

  /** "student@cslab:~/lab1$ " */
  prompt(): string {
    const home = this.home;
    const where =
      this.cwd === home
        ? '~'
        : this.cwd.startsWith(`${home}/`)
          ? `~${this.cwd.slice(home.length)}`
          : this.cwd;
    return `${this.user.name}@cslab:${where}${this.user.uid === 0 ? '#' : '$'} `;
  }

  fsError(cmd: string, e: unknown, shown?: string): Result {
    if (e instanceof FsError) return fail(`${cmd}: ${shown ?? e.path}: ${errorText(e)}`);
    throw e;
  }

  // ---- Expansion ----

  private expandParts(word: Word): { text: string; splittable: boolean }[] {
    const out: { text: string; splittable: boolean }[] = [];
    for (const p of word) {
      if (p.kind === 'lit') out.push({ text: p.text, splittable: false });
      else if (p.kind === 'tilde') out.push({ text: this.home, splittable: false });
      else if (p.kind === 'var') out.push({ text: this.getVar(p.name), splittable: !p.quoted });
      else if (p.kind === 'arith')
        out.push({ text: String(evalArith(p.expr, (n) => this.getVar(n))), splittable: false });
      else {
        const r = this.capture(p.source);
        out.push({ text: r.replace(/\n+$/, ''), splittable: !p.quoted });
      }
    }
    return out;
  }

  /** Expands one word into zero or more arguments: variables, $(...), word splitting, globs. */
  expandWord(word: Word): string[] {
    const pattern = globPattern(word);
    if (pattern !== null) {
      const matches = this.glob(pattern);
      if (matches.length > 0) return matches;
    }
    const parts = this.expandParts(word);
    // Unquoted $VAR / $(...) results are split on whitespace, like bash.
    const words: string[] = [];
    let current = '';
    let started = false;
    for (const p of parts) {
      if (!p.splittable) {
        current += p.text;
        started = true;
        continue;
      }
      const pieces = p.text.split(/[ \t\n]+/);
      pieces.forEach((piece, i) => {
        if (i > 0 && (current !== '' || started)) {
          words.push(current);
          current = '';
          started = false;
        }
        if (piece !== '') {
          current += piece;
          started = true;
        }
      });
    }
    if (started || current !== '' || (parts.length > 0 && parts.every((p) => !p.splittable)))
      words.push(current);
    return words;
  }

  expandOne(word: Word): string {
    return this.expandParts(word)
      .map((p) => p.text)
      .join('');
  }

  /** Expands a glob like "*.txt" or "lab?/notes.md" in the filesystem, sorted. */
  glob(pattern: string): string[] {
    const absolute = pattern.startsWith('/');
    const parts = pattern.split('/').filter(Boolean);
    let candidates: string[] = [absolute ? '/' : ''];
    for (const part of parts) {
      const next: string[] = [];
      for (const base of candidates) {
        const dir = base === '' ? this.cwd : this.abs(base);
        if (!/[*?[]/.test(part)) {
          next.push(
            base === ''
              ? part.replace(/\\(.)/g, '$1')
              : `${base === '/' ? '' : base}/${part.replace(/\\(.)/g, '$1')}`,
          );
          continue;
        }
        let entries: string[];
        try {
          entries = this.fs.list(dir, this.user).map(([n]) => n);
        } catch {
          continue;
        }
        const re = globToRegExp(part);
        for (const name of entries) {
          if (name.startsWith('.') && !part.startsWith('.')) continue;
          if (re.test(name)) next.push(base === '' ? name : `${base === '/' ? '' : base}/${name}`);
        }
      }
      candidates = next;
    }
    return candidates.filter((c) => this.fs.exists(this.abs(c), this.user)).sort();
  }

  // ---- Running ----

  /** Runs a full input line (or script) and returns what the terminal shows. */
  run(line: string): Result {
    const out = { out: '', err: '' };
    const code = this.runSource(line, out, true);
    this.lastCode = code;
    return { ...out, code };
  }

  /** Runs `src` and returns its stdout only (for $(...)). */
  capture(src: string): string {
    if (this.depth > MAX_DEPTH) return '';
    this.depth++;
    try {
      const sink = { out: '', err: '' };
      this.lastCode = this.runSource(src, sink, false);
      return sink.out;
    } finally {
      this.depth--;
    }
  }

  /** Splits source into statements on newlines and ';' (outside quotes and $(...)). */
  static statements(src: string): string[] {
    const out: string[] = [];
    let cur = '';
    let q: string | null = null;
    let paren = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i] as string;
      if (q) {
        cur += c;
        if (c === q) q = null;
        else if (c === '\\' && q === '"' && i + 1 < src.length) cur += src[++i];
        continue;
      }
      if (c === "'" || c === '"') q = c;
      if (c === '\\' && i + 1 < src.length) {
        cur += c + src[++i];
        continue;
      }
      if (c === '(') paren++;
      if (c === ')') paren--;
      if (c === '#' && (cur === '' || /\s$/.test(cur)) && paren === 0) {
        while (i < src.length && src[i] !== '\n') i++;
        out.push(cur);
        cur = '';
        continue;
      }
      if ((c === '\n' || (c === ';' && src[i + 1] !== ';')) && paren === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    out.push(cur);
    // "then echo hi" / "do x" / "else y": split the keyword from the command after it.
    const result: string[] = [];
    for (const s of out.map((x) => x.trim()).filter(Boolean)) {
      const m = /^(then|do|else)\s+(.+)$/.exec(s);
      if (m) result.push(m[1] as string, m[2] as string);
      else result.push(s);
    }
    return result;
  }

  private runSource(src: string, sink: { out: string; err: string }, tty: boolean): number {
    const stmts = Shell.statements(src);
    if (!stmts.some((s) => /^(if|for|while|until)\b/.test(s))) {
      let code = this.lastCode;
      for (const s of stmts) code = this.runStatement(s, sink, tty);
      return code;
    }
    let block: Block;
    try {
      [block] = this.parseBlock(stmts, 0, []);
    } catch (e) {
      if (e instanceof ParseError) {
        sink.err += `bash: ${e.message}
`;
        return 2;
      }
      throw e;
    }
    return this.runBlock(block, sink, tty);
  }

  private runStatement(stmt: string, sink: { out: string; err: string }, tty: boolean): number {
    let items: ListItem[];
    try {
      items = parse(this.expandAliases(stmt));
    } catch (e) {
      if (e instanceof ParseError) {
        sink.err += `bash: ${e.message}\n`;
        return 2;
      }
      throw e;
    }
    let code = this.lastCode;
    let skip = false;
    for (const item of items) {
      if (!skip) {
        if (item.op === '&') code = this.background(item.pipeline, sink);
        else code = this.runPipeline(item.pipeline, sink, tty);
        this.lastCode = code;
      }
      skip = (item.op === '&&' && code !== 0) || (item.op === '||' && code === 0);
      if (item.op === ';' || item.op === '&') skip = false;
    }
    return code;
  }

  private expandAliases(stmt: string): string {
    const m = /^(\s*)([A-Za-z_][\w.-]*)(.*)$/s.exec(stmt);
    if (!m) return stmt;
    const alias = this.aliases.get(m[2] as string);
    return alias ? `${m[1]}${alias}${m[3]}` : stmt;
  }

  // ---- Compound commands (if / for / while) ----

  private parseBlock(stmts: string[], i: number, stop: string[]): [Block, number] {
    const block: Block = [];
    while (i < stmts.length) {
      const s = stmts[i] as string;
      const kw = /^(\w+)/.exec(s)?.[1] ?? '';
      if (stop.includes(kw)) return [block, i];
      if (kw === 'if') {
        const branches: { cond: string; body: Block }[] = [];
        let cond = s.slice(2).trim();
        i++;
        let elseBody: Block | null = null;
        for (;;) {
          if (stmts[i] !== 'then') throw new ParseError("syntax error: expected 'then'");
          const [body, j] = this.parseBlock(stmts, i + 1, ['elif', 'else', 'fi']);
          branches.push({ cond, body });
          i = j;
          const next = stmts[i] ?? '';
          if (next.startsWith('elif')) {
            cond = next.slice(4).trim();
            i++;
            continue;
          }
          if (next === 'else') {
            const [eb, k] = this.parseBlock(stmts, i + 1, ['fi']);
            elseBody = eb;
            i = k;
          }
          if (stmts[i] !== 'fi') throw new ParseError("syntax error: expected 'fi'");
          i++;
          break;
        }
        block.push({ kind: 'if', branches, elseBody });
        continue;
      }
      if (kw === 'for') {
        const m = /^for\s+([A-Za-z_]\w*)(?:\s+in\s+(.*))?$/.exec(s);
        if (!m) throw new ParseError('syntax error in for loop');
        if (stmts[i + 1] !== 'do') throw new ParseError("syntax error: expected 'do'");
        const [body, j] = this.parseBlock(stmts, i + 2, ['done']);
        if (stmts[j] !== 'done') throw new ParseError("syntax error: expected 'done'");
        block.push({ kind: 'for', name: m[1] as string, list: m[2] ?? '"$@"', body });
        i = j + 1;
        continue;
      }
      if (kw === 'while' || kw === 'until') {
        if (stmts[i + 1] !== 'do') throw new ParseError("syntax error: expected 'do'");
        const [body, j] = this.parseBlock(stmts, i + 2, ['done']);
        if (stmts[j] !== 'done') throw new ParseError("syntax error: expected 'done'");
        block.push({ kind: 'while', until: kw === 'until', cond: s.slice(kw.length).trim(), body });
        i = j + 1;
        continue;
      }
      if (['then', 'do', 'done', 'fi', 'elif', 'else'].includes(kw)) {
        throw new ParseError(`syntax error near unexpected token \`${kw}'`);
      }
      block.push({ kind: 'cmd', src: s });
      i++;
    }
    if (stop.length > 0)
      throw new ParseError(
        `syntax error: unexpected end of input (missing '${stop[stop.length - 1]}')`,
      );
    return [block, i];
  }

  private runBlock(blockOrError: Block, sink: { out: string; err: string }, tty: boolean): number {
    let code = this.lastCode;
    for (const node of blockOrError) {
      if (node.kind === 'cmd') code = this.runStatement(node.src, sink, tty);
      else if (node.kind === 'if') {
        const branch = node.branches.find((b) => this.runStatement(b.cond, sink, tty) === 0);
        if (branch) code = this.runBlock(branch.body, sink, tty);
        else if (node.elseBody) code = this.runBlock(node.elseBody, sink, tty);
        else code = 0;
      } else if (node.kind === 'for') {
        let values: string[];
        try {
          values =
            parse(`: ${node.list}`)[0]
              ?.pipeline[0]?.words.slice(1)
              .flatMap((w) => this.expandWord(w)) ?? [];
        } catch {
          values = [];
        }
        code = 0;
        for (const v of values.slice(0, MAX_LOOP)) {
          this.vars.set(node.name, v);
          code = this.runBlock(node.body, sink, tty);
        }
      } else {
        code = 0;
        let n = 0;
        while ((this.runStatement(node.cond, sink, tty) === 0) !== node.until) {
          if (++n > MAX_LOOP) {
            sink.err += `bash: loop stopped after ${MAX_LOOP} iterations (infinite loop?)\n`;
            return 1;
          }
          code = this.runBlock(node.body, sink, tty);
        }
      }
      this.lastCode = code;
    }
    return code;
  }

  // ---- Pipelines, redirections and processes ----

  private runPipeline(
    pipeline: SimpleCommand[],
    sink: { out: string; err: string },
    tty: boolean,
  ): number {
    let stdin = '';
    let code = 0;
    pipeline.forEach((cmd, i) => {
      const last = i === pipeline.length - 1;
      const r = this.runCommand(cmd, stdin, tty && last);
      sink.err += r.err;
      if (last) sink.out += r.out;
      else stdin = r.out;
      code = r.code;
    });
    this.fs.now += 1;
    this.reapJobs();
    return code;
  }

  runCommand(cmd: SimpleCommand, stdin: string, tty: boolean): Result {
    let args: string[];
    try {
      args = cmd.words.flatMap((w) => this.expandWord(w));
    } catch (e) {
      if (e instanceof ExitSignal) throw e;
      return fail(`bash: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (args.length === 0) {
      for (const a of cmd.assigns) this.vars.set(a.name, this.expandOne(a.value));
      if (cmd.redirects.length === 0) return ok();
    }

    // Redirections: input first, then decide where stdout and stderr go.
    let outFile: { path: string; append: boolean } | null = null;
    let errFile: { path: string; append: boolean } | null = null;
    let errToOut = false;
    for (const r of cmd.redirects) {
      const target = r.target ? this.abs(this.expandOne(r.target)) : '';
      if (r.op === '<') {
        try {
          stdin = this.fs.read(target, this.user);
        } catch (e) {
          return this.fsError('bash', e, r.target ? this.expandOne(r.target) : '');
        }
      } else if (r.op === '>' || r.op === '>>') outFile = { path: target, append: r.op === '>>' };
      else if (r.op === '2>' || r.op === '2>>') errFile = { path: target, append: r.op === '2>>' };
      else if (r.op === '&>') {
        outFile = { path: target, append: false };
        errToOut = true;
      } else errToOut = true;
    }
    // Like bash, "> file" truncates/creates the file before the command runs.
    for (const f of [outFile, errFile]) {
      if (!f) continue;
      try {
        this.fs.write(f.path, '', this.user, this.umask, true);
        if (!f.append) this.fs.write(f.path, '', this.user, this.umask, false);
      } catch (e) {
        return this.fsError('bash', e, basename(f.path));
      }
    }

    const saved = new Map<string, string | undefined>();
    for (const a of cmd.assigns) {
      saved.set(a.name, this.vars.get(a.name));
      this.vars.set(a.name, this.expandOne(a.value));
    }
    let r: Result;
    try {
      r = args.length > 0 ? this.exec(args, stdin, tty && !outFile) : ok();
    } finally {
      if (args.length > 0) {
        for (const [k, v] of saved) {
          if (v === undefined) this.vars.delete(k);
          else this.vars.set(k, v);
        }
      }
    }
    if (errToOut) r = { ...r, out: r.out + r.err, err: '' };
    try {
      if (outFile) {
        this.fs.write(outFile.path, r.out, this.user, this.umask, true);
        r = { ...r, out: '' };
      }
      if (errFile) {
        this.fs.write(errFile.path, r.err, this.user, this.umask, true);
        r = { ...r, err: '' };
      }
    } catch (e) {
      return this.fsError('bash', e);
    }
    return r;
  }

  /** Runs one command: builtin, script file, or "command not found". */
  exec(args: string[], stdin: string, tty: boolean): Result {
    const [name, ...rest] = args as [string, ...string[]];
    if (name.includes('/')) return this.runScriptFile(name, rest, true);
    const fn: CommandFn | undefined = COMMANDS[name];
    if (!fn) {
      const hint = name === 'cls' ? " (try 'clear')" : name === 'dir' ? " (try 'ls')" : '';
      return fail(`${name}: command not found${hint}`, 127);
    }
    return fn({ shell: this, name, args: rest, stdin, tty });
  }

  /** ./script.sh (needs r and x) or bash script.sh (needs r only). */
  runScriptFile(path: string, args: string[], needsExec: boolean): Result {
    const abs = this.abs(path);
    let src: string;
    try {
      const node = this.fs.lookup(abs, this.user);
      if (node.type === 'dir') return fail(`bash: ${path}: Is a directory`, 126);
      if (needsExec && !can(node, this.user, 'x'))
        return fail(`bash: ${path}: Permission denied`, 126);
      src = this.fs.read(abs, this.user);
    } catch (e) {
      if (e instanceof FsError)
        return fail(`bash: ${path}: ${errorText(e)}`, e.code === 'ENOENT' ? 127 : 126);
      throw e;
    }
    if (this.depth > MAX_DEPTH) return fail('bash: maximum script nesting reached');
    const savedArgs = this.positional;
    this.positional = args;
    this.depth++;
    const sink = { out: '', err: '' };
    let code: number;
    try {
      code = this.runSource(src, sink, true);
    } catch (e) {
      if (e instanceof ExitSignal) code = e.code;
      else if (e instanceof ParseError) {
        sink.err += `${path}: ${e.message}\n`;
        code = 2;
      } else throw e;
    } finally {
      this.positional = savedArgs;
      this.depth--;
    }
    return { ...sink, code };
  }

  private background(pipeline: SimpleCommand[], sink: { out: string; err: string }): number {
    const words = pipeline[0]?.words.flatMap((w) => this.expandWord(w)) ?? [];
    const job = this.nextJob++;
    const pid = this.nextPid++;
    const cmdText = words.join(' ');
    // sleep keeps running in the background; anything else finishes right away.
    const duration =
      words[0] === 'sleep' && pipeline.length === 1 ? parseDuration(words[1] ?? '') : 0;
    if (words[0] === 'sleep' && duration === null) {
      sink.err += `sleep: invalid time interval '${words[1] ?? ''}'\n`;
      return 1;
    }
    let r: Result = ok();
    if (words[0] !== 'sleep') r = this.runPipelineCapture(pipeline);
    this.procs.push({
      pid,
      ppid: this.shellPid,
      user: this.user.name,
      cmd: cmdText,
      start: this.fs.now,
      end: this.fs.now + (duration ?? 0),
      job,
      tty: 'pts/0',
    });
    sink.out += `[${job}] ${pid}\n${r.out}`;
    sink.err += r.err;
    this.fs.now += 1;
    return 0;
  }

  private runPipelineCapture(pipeline: SimpleCommand[]): Result {
    const sink = { out: '', err: '' };
    const code = this.runPipeline(pipeline, sink, false);
    return { ...sink, code };
  }

  /** Finished background jobs print "[1]+  Done   sleep 5" before the next prompt. */
  reapJobs(): void {
    const done = this.procs.filter((p) => p.end !== null && p.end <= this.fs.now && p.job !== null);
    for (const p of done) this.notices.push(`[${p.job}]+  Done                    ${p.cmd}`);
    this.procs = this.procs.filter((p) => !done.includes(p));
    if (!this.procs.some((p) => p.job !== null)) this.nextJob = 1;
  }

  /** The UI calls this after printing a command's output. */
  takeNotices(): string[] {
    const n = this.notices;
    this.notices = [];
    return n;
  }

  /** Applies an editor save (nano / vi) as the current user. */
  saveFile(save: EditorSave): Result {
    try {
      this.fs.write(this.abs(save.path), save.content, this.user, this.umask);
      this.fs.now += 1;
      return ok();
    } catch (e) {
      return this.fsError('nano', e, save.path);
    }
  }

  /** Replays a history entry (a command line or an editor save). */
  replay(entry: HistoryEntry): Result {
    this.history.push(entry);
    if (typeof entry !== 'string') return this.saveFile(entry);
    let r: Result;
    try {
      r = this.run(entry);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
      this.lastCode = e.code;
      r = ok();
    }
    this.log.push({ line: entry, ...r });
    return r;
  }

  becomeRoot(): void {
    this.users.push(ROOT);
    this.oldPwd = this.cwd;
  }

  dirOf(path: string): string {
    return dirname(this.abs(path));
  }
}

type Block = BlockNode[];
type BlockNode =
  | { kind: 'cmd'; src: string }
  | { kind: 'if'; branches: { cond: string; body: Block }[]; elseBody: Block | null }
  | { kind: 'for'; name: string; list: string; body: Block }
  | { kind: 'while'; until: boolean; cond: string; body: Block };

/** "5", "2m", "1.5" → seconds. */
export function parseDuration(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(text);
  if (!m) return null;
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as string] as number;
  return Math.ceil(Number(m[1]) * mult);
}
