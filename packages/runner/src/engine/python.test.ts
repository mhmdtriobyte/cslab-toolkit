import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PYTHON_HARNESS } from './pythonHarness';
import { parseClangDiagnostics, type TraceStep } from './protocol';

interface Py {
  runPython(code: string): unknown;
  globals: { set(name: string, value: unknown): void };
}

let py: Py;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const dir = dirname(require.resolve('pyodide/package.json'));
  const { loadPyodide } = (await import(pathToFileURL(`${dir}/pyodide.mjs`).href)) as {
    loadPyodide: (o: { indexURL: string }) => Promise<Py>;
  };
  py = await loadPyodide({ indexURL: `${dir}/` });
}, 120_000);

function run(code: string, stdin = '', trace = false) {
  let out = '';
  let err = '';
  py.globals.set('_student_code', code);
  py.globals.set('_student_stdin', stdin);
  py.globals.set('_want_trace', trace);
  py.globals.set('_emit_out', (s: string) => (out += s));
  py.globals.set('_emit_err', (s: string) => (err += s));
  const r = JSON.parse(py.runPython(PYTHON_HARNESS) as string) as {
    exitCode: number;
    error: { message: string; line: number | null } | null;
    trace: TraceStep[] | null;
    truncated: boolean;
  };
  return { ...r, out, err };
}

describe('python harness', () => {
  it('runs code and reads input() from the input box, echoing like a terminal', () => {
    const r = run(
      'name = input("Name? ")\nn = int(input())\nprint("Hi", name, n * 2)',
      'Lea\n21\n',
    );
    expect(r.out).toBe('Name? Lea\n21\nHi Lea 42\n');
    expect(r.exitCode).toBe(0);
    expect(r.error).toBeNull();
  });

  it('reports runtime errors with the line, hiding the harness frames', () => {
    const r = run('def f(x):\n    return 10 / x\n\nprint(f(2))\nprint(f(0))');
    expect(r.out).toBe('5.0\n');
    expect(r.error).toEqual({ message: 'ZeroDivisionError: division by zero', line: 2 });
    expect(r.err).toContain('File "main.py", line 5, in <module>');
    expect(r.err).toContain('File "main.py", line 2, in f');
    expect(r.err).not.toContain('<student>');
  });

  it('reports syntax errors', () => {
    const r = run('print("a")\nif x\n  print(1)');
    expect(r.error?.line).toBe(2);
    expect(r.error?.message).toMatch(/SyntaxError/);
    expect(r.out).toBe('');
  });

  it('runs out of input with a helpful EOFError', () => {
    const r = run('a = input()\nb = input()', 'only one\n');
    expect(r.error?.message).toMatch(/EOFError.*Input box/);
  });

  it('records a line trace with locals and call frames', () => {
    const r = run(
      'def sq(n):\n    r = n * n\n    return r\n\nx = 3\ny = sq(x)\nprint(y)',
      '',
      true,
    );
    const t = r.trace as TraceStep[];
    expect(t.map((s) => `${s.event}:${s.line}`)).toEqual([
      'line:1',
      'line:5',
      'line:6',
      'call:1',
      'line:2',
      'line:3',
      'return:3',
      'line:7',
      'return:7',
    ]);
    const inside = t[5] as TraceStep;
    expect(inside.stack.map((f) => f.func)).toEqual(['global', 'sq']);
    expect(inside.stack[1]?.vars).toEqual([
      { name: 'n', value: '3', type: 'int' },
      { name: 'r', value: '9', type: 'int' },
    ]);
    expect(t[6]?.detail).toBe('9');
    expect(t[8]?.stdoutLength).toBe(2);
    const globals = (t[8] as TraceStep).stack[0]?.vars.map((v) => v.name);
    expect(globals).toEqual(['sq', 'x', 'y']);
  });

  it('stops tracing infinite loops at the step limit', () => {
    const r = run('i = 0\nwhile True:\n    i += 1', '', true);
    expect(r.truncated).toBe(true);
    expect(r.trace?.length).toBeGreaterThan(1000);
  });

  it('a fresh namespace every run', () => {
    run('secret = 1');
    expect(run('print(secret)').error?.message).toMatch(/NameError/);
  });

  it('exit codes', () => {
    expect(run('import sys\nsys.exit(3)').exitCode).toBe(3);
    expect(run('exit()').exitCode).toBe(0);
  });
});

interface Preset {
  id: string;
  input: { language: string; python?: string; pythonStdin?: string; c?: string };
}

const presets = import.meta.glob<Preset>('../../../../examples/runner/*.json', {
  eager: true,
  import: 'default',
});

describe('runner presets', () => {
  it.each(Object.entries(presets))('%s is valid', (path, p) => {
    expect(path.endsWith(`/${p.id}.json`)).toBe(true);
    expect(p.id.startsWith(p.input.language === 'c' ? 'c-' : 'py-')).toBe(true);
    if (p.input.language !== 'python') {
      expect(p.input.c).toContain('int main');
      return;
    }
    const r = run(p.input.python ?? '', p.input.pythonStdin ?? '', true);
    if (p.id === 'py-error') expect(r.error?.message).toMatch(/IndexError/);
    else {
      expect(r.error).toBeNull();
      expect(r.out.length).toBeGreaterThan(0);
      expect(r.truncated).toBe(false);
    }
  });
});

describe('clang diagnostics', () => {
  it('parses errors and warnings', () => {
    const d = parseClangDiagnostics(
      "main.c:4:5: warning: unused variable 'x' [-Wunused-variable]\n    4 | int x;\nmain.c:7:12: error: expected ';' after expression\n",
    );
    expect(d).toEqual([
      {
        line: 4,
        column: 5,
        severity: 'warning',
        message: "unused variable 'x' [-Wunused-variable]",
      },
      { line: 7, column: 12, severity: 'error', message: "expected ';' after expression" },
    ]);
  });
});
