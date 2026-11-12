import { MAX_TRACE_STEPS, type Frame, type TraceStep, type Variable } from './protocol';

/**
 * Line-by-line tracing for real C. clang's JSON AST tells us where every statement starts and which
 * variables are in scope; we insert calls to tiny imported functions before each statement that
 * hand JavaScript the address of every visible variable, then compile the instrumented copy with
 * clang. JavaScript reads the values straight out of WebAssembly memory, so what students see is
 * exactly what the real program holds, uninitialised garbage included.
 */

// ---- Minimal view of clang's JSON AST ----

interface Loc {
  offset?: number;
  file?: string;
  tokLen?: number;
  includedFrom?: unknown;
  spellingLoc?: Loc;
  expansionLoc?: Loc;
}

export interface AstNode {
  id?: string;
  kind?: string;
  name?: string;
  type?: { qualType: string; desugaredQualType?: string };
  loc?: Loc;
  range?: { begin: Loc; end: Loc };
  inner?: AstNode[];
  isBitfield?: boolean;
  storageClass?: string;
  tagUsed?: string;
  completeDefinition?: boolean;
  isImplicit?: boolean;
}

// ---- C types we can display ----

export type CType =
  | { k: 'int'; size: 1 | 2 | 4 | 8; signed: boolean; char?: boolean }
  | { k: 'float'; size: 4 | 8 }
  | { k: 'bool' }
  | { k: 'ptr'; to: string }
  | { k: 'array'; of: CType; n: number }
  | { k: 'struct'; fields: { name: string; offset: number; type: CType }[]; size: number };

const SCALARS: Record<string, CType> = {
  char: { k: 'int', size: 1, signed: true, char: true },
  'signed char': { k: 'int', size: 1, signed: true, char: true },
  'unsigned char': { k: 'int', size: 1, signed: false, char: true },
  short: { k: 'int', size: 2, signed: true },
  'short int': { k: 'int', size: 2, signed: true },
  'unsigned short': { k: 'int', size: 2, signed: false },
  'unsigned short int': { k: 'int', size: 2, signed: false },
  int: { k: 'int', size: 4, signed: true },
  signed: { k: 'int', size: 4, signed: true },
  'signed int': { k: 'int', size: 4, signed: true },
  unsigned: { k: 'int', size: 4, signed: false },
  'unsigned int': { k: 'int', size: 4, signed: false },
  // wasm32 is ILP32: long and pointers are 4 bytes.
  long: { k: 'int', size: 4, signed: true },
  'long int': { k: 'int', size: 4, signed: true },
  'unsigned long': { k: 'int', size: 4, signed: false },
  'unsigned long int': { k: 'int', size: 4, signed: false },
  'long long': { k: 'int', size: 8, signed: true },
  'long long int': { k: 'int', size: 8, signed: true },
  'unsigned long long': { k: 'int', size: 8, signed: false },
  'unsigned long long int': { k: 'int', size: 8, signed: false },
  float: { k: 'float', size: 4 },
  double: { k: 'float', size: 8 },
  _Bool: { k: 'bool' },
  bool: { k: 'bool' },
};

function sizeOf(t: CType): number {
  if (t.k === 'int') return t.size;
  if (t.k === 'float') return t.size;
  if (t.k === 'bool') return 1;
  if (t.k === 'ptr') return 4;
  if (t.k === 'array') return sizeOf(t.of) * t.n;
  return t.size;
}

function alignOf(t: CType): number {
  if (t.k === 'array') return alignOf(t.of);
  if (t.k === 'struct') return Math.max(1, ...t.fields.map((f) => alignOf(f.type)));
  return sizeOf(t);
}

export type RecordTable = Map<string, { name: string; type: string; bitfield: boolean }[]>;

/** Parses a clang qualType like "const int [3][4]" or "struct pt *". Null if we cannot show it. */
export function parseCType(raw: string, records: RecordTable, depth = 0): CType | null {
  if (depth > 4) return null;
  const q = raw
    .replace(/\b(const|volatile|restrict|__restrict|static)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const arr = /^(.*?)\s*((?:\[\d+\])+)$/.exec(q);
  if (arr) {
    const dims = [...(arr[2] as string).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    let t = parseCType(arr[1] as string, records, depth + 1);
    if (!t) return null;
    for (let i = dims.length - 1; i >= 0; i--) t = { k: 'array', of: t, n: dims[i] as number };
    return t;
  }
  if (q.endsWith('*') || q.includes('(*)')) return { k: 'ptr', to: q.replace(/\s*\*$/, '').trim() };
  if (SCALARS[q]) return SCALARS[q] as CType;
  if (q.startsWith('enum ')) return { k: 'int', size: 4, signed: true };
  const fields = records.get(q);
  if (fields) {
    let offset = 0;
    let align = 1;
    const out: { name: string; offset: number; type: CType }[] = [];
    for (const f of fields) {
      if (f.bitfield) return null;
      const t = parseCType(f.type, records, depth + 1);
      if (!t) return null;
      const a = alignOf(t);
      align = Math.max(align, a);
      offset = Math.ceil(offset / a) * a;
      out.push({ name: f.name, offset, type: t });
      offset += sizeOf(t);
    }
    return { k: 'struct', fields: out, size: Math.ceil(offset / align) * align };
  }
  return null;
}

function typeName(n: AstNode): string {
  return n.type?.desugaredQualType ?? n.type?.qualType ?? '';
}

// ---- Instrumentation ----

export interface TracedVar {
  name: string;
  /** As written in the source, for the variables table. */
  typeText: string;
  type: CType;
  global: boolean;
}

export interface Instrumented {
  code: string;
  functions: string[];
  vars: TracedVar[];
}

interface Insert {
  offset: number;
  /** Lower first at the same offset: closing braces before new traces. */
  priority: number;
  text: string;
}

const PRELUDE =
  'void __oslab_step(int, int) __attribute__((import_module("oslab"), import_name("step")));' +
  'void __oslab_var(int, const void *) __attribute__((import_module("oslab"), import_name("var")));' +
  'int __oslab_enter(int) __attribute__((import_module("oslab"), import_name("enter")));' +
  'void __oslab_leave_(void) __attribute__((import_module("oslab"), import_name("leave")));' +
  'static inline void __oslab_leave(int *p) { (void)p; __oslab_leave_(); }\n#line 1 "main.c"\n';

const off = (l: Loc | undefined): number | undefined => (l?.expansionLoc ?? l)?.offset;
const tokEnd = (l: Loc | undefined): number | undefined => {
  const x = l?.expansionLoc ?? l;
  return x?.offset === undefined ? undefined : x.offset + (x.tokLen ?? 0);
};

/** The top-level declarations that come from main.c itself, not from #included headers. */
export function userDecls(ast: AstNode): AstNode[] {
  let file = '';
  const out: AstNode[] = [];
  for (const d of ast.inner ?? []) {
    const loc = d.loc?.expansionLoc ?? d.loc;
    if (loc?.file) file = loc.file;
    if (d.loc?.spellingLoc?.file) file = d.loc.spellingLoc.file;
    if (d.isImplicit || loc?.includedFrom || d.range?.begin?.includedFrom) continue;
    if (file === 'main.c' || file === '') {
      if (loc?.offset !== undefined) out.push(d);
    }
  }
  return out;
}

export function instrument(source: string, ast: AstNode): Instrumented {
  const decls = userDecls(ast);
  const records: RecordTable = new Map();
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const colOf = (offset: number) => offset - (lineStarts[lineOf(offset) - 1] as number) + 1;

  const addRecord = (d: AstNode) => {
    if (d.kind !== 'RecordDecl' || !d.completeDefinition || d.tagUsed !== 'struct') return;
    const fields = (d.inner ?? [])
      .filter((f) => f.kind === 'FieldDecl')
      .map((f) => ({ name: f.name ?? '', type: typeName(f), bitfield: f.isBitfield === true }));
    if (d.name) records.set(`struct ${d.name}`, fields);
    const o = off(d.loc);
    if (o !== undefined) {
      records.set(`struct (unnamed struct at main.c:${lineOf(o)}:${colOf(o)})`, fields);
    }
  };
  const walkRecords = (n: AstNode) => {
    addRecord(n);
    for (const c of n.inner ?? []) if (c && c.kind) walkRecords(c);
  };
  decls.forEach(walkRecords);

  const vars: TracedVar[] = [];
  const functions: string[] = [];
  const inserts: Insert[] = [];

  const declare = (n: AstNode, global: boolean): number[] => {
    if (!n.name || n.storageClass === 'extern') return [];
    const typeText = n.type?.qualType ?? '';
    const type = parseCType(typeName(n), records);
    if (!type) return [];
    vars.push({ name: n.name, typeText, type, global });
    return [vars.length - 1];
  };

  const globals: number[] = [];
  for (const d of decls) if (d.kind === 'VarDecl') globals.push(...declare(d, true));

  const trace = (fid: number, offset: number, scope: number[]) => {
    const calls = [...globals, ...scope]
      .map((v) => `__oslab_var(${v}, &${(vars[v] as TracedVar).name});`)
      .join('');
    return `__oslab_step(${fid}, ${lineOf(offset)});${calls}`;
  };

  /** Where a statement really ends, including its ';' when it is not a block. */
  const stmtEnd = (s: AstNode): number | null => {
    const end = tokEnd(s.range?.end);
    if (end === undefined) return null;
    if (s.kind === 'CompoundStmt') return end;
    let i = end;
    while (i < source.length && /\s/.test(source[i] as string)) i++;
    return source[i] === ';' ? i + 1 : end;
  };

  const kids = (n: AstNode) => (n.inner ?? []).filter((c) => c && c.kind);

  const visitStmt = (s: AstNode, fid: number, scope: number[]) => {
    switch (s.kind) {
      case 'CompoundStmt':
        visitBlock(s, fid, scope, false);
        return;
      case 'IfStmt': {
        const [, ...branches] = kids(s);
        for (const b of branches) body(b, fid, scope);
        return;
      }
      case 'WhileStmt':
      case 'SwitchStmt': {
        const k = kids(s);
        body(k[k.length - 1] as AstNode, fid, scope);
        return;
      }
      case 'DoStmt':
        body(kids(s)[0] as AstNode, fid, scope);
        return;
      case 'ForStmt': {
        const inner = s.inner ?? [];
        const init = inner[0];
        const inScope = [...scope];
        if (init?.kind === 'DeclStmt') {
          for (const d of kids(init)) if (d.kind === 'VarDecl') inScope.push(...declare(d, false));
        }
        const b = inner[inner.length - 1];
        if (b?.kind) body(b, fid, inScope);
        return;
      }
      case 'CaseStmt':
      case 'DefaultStmt':
      case 'LabelStmt': {
        const k = kids(s);
        const sub = k[k.length - 1];
        if (sub && sub.kind !== 'ConstantExpr') {
          const o = off(sub.range?.begin);
          if (o !== undefined && !isLabel(sub))
            inserts.push({ offset: o, priority: 1, text: trace(fid, o, scope) });
          visitStmt(sub, fid, scope);
        }
        return;
      }
      default:
        return;
    }
  };

  const isLabel = (s: AstNode) =>
    s.kind === 'CaseStmt' || s.kind === 'DefaultStmt' || s.kind === 'LabelStmt';

  /** The body of an if/for/while: a block is walked, a single statement gets braces and a trace. */
  const body = (s: AstNode, fid: number, scope: number[]) => {
    if (!s) return;
    if (s.kind === 'CompoundStmt') {
      visitBlock(s, fid, scope, false);
      return;
    }
    if (s.kind === 'NullStmt') return;
    const start = off(s.range?.begin);
    const end = stmtEnd(s);
    if (start === undefined || end === null) return;
    inserts.push({ offset: start, priority: 1, text: `{${trace(fid, start, scope)}` });
    visitStmt(s, fid, scope);
    inserts.push({ offset: end, priority: 0, text: '}' });
  };

  const visitBlock = (block: AstNode, fid: number, outer: number[], isFunctionBody: boolean) => {
    const scope = [...outer];
    for (const s of kids(block)) {
      const o = off(s.range?.begin);
      if (o === undefined) continue;
      if (!isLabel(s)) inserts.push({ offset: o, priority: 1, text: trace(fid, o, scope) });
      if (s.kind === 'DeclStmt') {
        for (const d of kids(s)) {
          if (d.kind === 'VarDecl' && d.storageClass !== 'static') scope.push(...declare(d, false));
          else if (d.kind === 'VarDecl') scope.push(...declare(d, false));
          else walkRecords(d);
        }
      } else visitStmt(s, fid, scope);
    }
    if (isFunctionBody) {
      // One last step on the closing brace, so the final values are visible.
      const close = off(block.range?.end);
      if (close !== undefined)
        inserts.push({ offset: close, priority: 1, text: trace(fid, close, scope) });
    }
  };

  for (const d of decls) {
    if (d.kind !== 'FunctionDecl') continue;
    const bodyNode = (d.inner ?? []).find((c) => c.kind === 'CompoundStmt');
    if (!bodyNode) continue;
    const fid = functions.length;
    functions.push(d.name ?? '?');
    const params: number[] = [];
    for (const p of d.inner ?? []) if (p.kind === 'ParmVarDecl') params.push(...declare(p, false));
    const open = off(bodyNode.range?.begin);
    if (open === undefined) continue;
    inserts.push({
      offset: open + 1,
      priority: 0,
      text: `int __oslab_g __attribute__((cleanup(__oslab_leave))) = __oslab_enter(${fid});`,
    });
    visitBlock(bodyNode, fid, params, true);
  }

  const sorted = inserts
    .map((x, seq) => ({ ...x, seq }))
    .sort((a, b) => a.offset - b.offset || a.priority - b.priority || a.seq - b.seq);
  let out = '';
  let at = 0;
  for (const ins of sorted) {
    out += source.slice(at, ins.offset) + ins.text;
    at = ins.offset;
  }
  out += source.slice(at);
  return { code: PRELUDE + out, functions, vars };
}

// ---- Reading values at run time ----

function hex(n: number) {
  return `0x${n.toString(16).padStart(8, '0')}`;
}

function charText(c: number) {
  if (c === 0) return "'\\0'";
  if (c === 10) return "'\\n'";
  if (c === 9) return "'\\t'";
  return c >= 32 && c < 127 ? `'${String.fromCharCode(c)}'` : `'\\x${c.toString(16)}'`;
}

function cString(mem: DataView, ptr: number, max = 60): string | null {
  if (ptr <= 0 || ptr >= mem.byteLength) return null;
  let s = '';
  for (let i = 0; i < max; i++) {
    if (ptr + i >= mem.byteLength) return null;
    const c = mem.getUint8(ptr + i);
    if (c === 0) return JSON.stringify(s);
    if (c < 9 || (c > 13 && c < 32) || c > 126) return null;
    s += String.fromCharCode(c);
  }
  return `${JSON.stringify(s).slice(0, -1)}…"`;
}

function fmtFloat(x: number) {
  if (!Number.isFinite(x)) return String(x);
  const s = x.toPrecision(6);
  return s.includes('e') ? s : String(Number(s)) + (Number.isInteger(Number(s)) ? '.0' : '');
}

export function readValue(mem: DataView, addr: number, t: CType, budget = { n: 200 }): string {
  if (addr < 0 || addr + sizeOf(t) > mem.byteLength) return '?';
  if (t.k === 'int') {
    let v: number | bigint;
    if (t.size === 1) v = t.signed ? mem.getInt8(addr) : mem.getUint8(addr);
    else if (t.size === 2) v = t.signed ? mem.getInt16(addr, true) : mem.getUint16(addr, true);
    else if (t.size === 4) v = t.signed ? mem.getInt32(addr, true) : mem.getUint32(addr, true);
    else v = t.signed ? mem.getBigInt64(addr, true) : mem.getBigUint64(addr, true);
    return t.char ? `${v} ${charText(mem.getUint8(addr))}` : String(v);
  }
  if (t.k === 'float')
    return fmtFloat(t.size === 4 ? mem.getFloat32(addr, true) : mem.getFloat64(addr, true));
  if (t.k === 'bool') return mem.getUint8(addr) ? 'true' : 'false';
  if (t.k === 'ptr') {
    const p = mem.getUint32(addr, true);
    if (p === 0) return 'NULL';
    if (t.to === 'char' || t.to === 'unsigned char' || t.to === 'signed char') {
      const s = cString(mem, p);
      return s ? `${hex(p)} → ${s}` : hex(p);
    }
    return hex(p);
  }
  if (t.k === 'struct') {
    return `{${t.fields.map((f) => `.${f.name} = ${readValue(mem, addr + f.offset, f.type, budget)}`).join(', ')}}`;
  }
  // Array.
  if (t.of.k === 'int' && t.of.char && t.of.size === 1) {
    let s = '';
    let end = -1;
    for (let i = 0; i < t.n; i++) {
      const c = mem.getUint8(addr + i);
      if (c === 0) {
        end = i;
        break;
      }
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : '?';
    }
    if (end >= 0) return `${JSON.stringify(s)} (${t.n} bytes)`;
  }
  const items: string[] = [];
  const el = sizeOf(t.of);
  for (let i = 0; i < t.n; i++) {
    if (budget.n-- <= 0) {
      items.push('…');
      break;
    }
    const v = readValue(mem, addr + i * el, t.of, budget);
    items.push(t.of.k === 'int' && t.of.char ? (v.split(' ')[1] ?? v) : v);
  }
  return `{${items.join(', ')}}`;
}

export class TraceLimit extends Error {
  constructor() {
    super('trace limit');
  }
}

/** Collects TraceSteps from the instrumented program's calls into the "oslab" import module. */
export class CTraceRecorder {
  steps: TraceStep[] = [];
  private stack: Frame[] = [];
  private globals: Variable[] = [];
  private pending = false;
  private current: Variable[] = [];
  private currentGlobals: Variable[] = [];

  constructor(
    private readonly info: Instrumented,
    private readonly memory: () => WebAssembly.Memory | null,
    private readonly stdoutLength: () => number,
  ) {}

  private flush() {
    if (!this.pending) return;
    this.pending = false;
    const top = this.stack[this.stack.length - 1];
    if (top) top.vars = this.current;
    this.globals = this.currentGlobals;
    const frames = this.stack.map((f) => ({ ...f, vars: [...f.vars] }));
    const stack = this.globals.length
      ? [{ func: 'global', line: 0, vars: this.globals }, ...frames]
      : frames;
    const step: TraceStep = {
      line: top?.line ?? 0,
      event: 'line',
      stack,
      stdoutLength: this.stdoutLength(),
    };
    // "if (x) y;" on one line traces the if and its body: drop the step if nothing changed.
    const prev = this.steps[this.steps.length - 1];
    if (
      prev &&
      prev.line === step.line &&
      prev.stdoutLength === step.stdoutLength &&
      JSON.stringify(prev.stack) === JSON.stringify(step.stack)
    ) {
      return;
    }
    this.steps.push(step);
  }

  imports(): Record<string, WebAssembly.ImportValue> {
    return {
      enter: (fid: number) => {
        this.flush();
        this.stack.push({ func: this.info.functions[fid] ?? '?', line: 0, vars: [] });
        return this.stack.length;
      },
      leave: () => {
        this.flush();
        this.stack.pop();
      },
      step: (_fid: number, line: number) => {
        this.flush();
        if (this.steps.length >= MAX_TRACE_STEPS) throw new TraceLimit();
        const top = this.stack[this.stack.length - 1];
        if (top) top.line = line;
        this.pending = true;
        this.current = [];
        this.currentGlobals = [];
      },
      var: (vid: number, addr: number) => {
        const v = this.info.vars[vid];
        const mem = this.memory();
        if (!v || !mem) return;
        const entry = {
          name: v.name,
          type: v.typeText,
          value: readValue(new DataView(mem.buffer), addr, v.type),
        };
        (v.global ? this.currentGlobals : this.current).push(entry);
      },
    };
  }

  finish(): TraceStep[] {
    this.flush();
    return this.steps;
  }
}
