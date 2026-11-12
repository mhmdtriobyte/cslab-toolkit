import { describe, expect, it } from 'vitest';
import { instrument, parseCType, readValue, type AstNode, type RecordTable } from './cTrace';
import { Wasi } from './wasi';

const none: RecordTable = new Map();

describe('C types', () => {
  it('parses scalars, pointers, arrays and structs with wasm32 layout', () => {
    expect(parseCType('const unsigned int', none)).toEqual({ k: 'int', size: 4, signed: false });
    expect(parseCType('long', none)).toEqual({ k: 'int', size: 4, signed: true });
    expect(parseCType('char *', none)).toEqual({ k: 'ptr', to: 'char' });
    expect(parseCType('int [2][3]', none)).toEqual({
      k: 'array',
      n: 2,
      of: { k: 'array', n: 3, of: { k: 'int', size: 4, signed: true } },
    });
    const records: RecordTable = new Map([
      [
        'struct s',
        [
          { name: 'c', type: 'char', bitfield: false },
          { name: 'd', type: 'double', bitfield: false },
        ],
      ],
    ]);
    const s = parseCType('struct s', records);
    expect(s).toMatchObject({ k: 'struct', size: 16 });
    expect(s?.k === 'struct' && s.fields[1]?.offset).toBe(8);
    expect(parseCType('struct unknown', none)).toBeNull();
  });

  it('reads values from memory', () => {
    const mem = new DataView(new ArrayBuffer(64));
    mem.setInt32(0, -5, true);
    mem.setInt32(4, 7, true);
    mem.setFloat64(8, 2.5, true);
    [72, 105, 0].forEach((c, i) => mem.setUint8(16 + i, c));
    mem.setUint32(24, 16, true);
    const int = parseCType('int', none)!;
    expect(readValue(mem, 0, int)).toBe('-5');
    expect(readValue(mem, 0, parseCType('int [2]', none)!)).toBe('{-5, 7}');
    expect(readValue(mem, 8, parseCType('double', none)!)).toBe('2.5');
    expect(readValue(mem, 16, parseCType('char [4]', none)!)).toBe('"Hi" (4 bytes)');
    expect(readValue(mem, 16, parseCType('char', none)!)).toBe("72 'H'");
    expect(readValue(mem, 24, parseCType('char *', none)!)).toBe('0x00000010 → "Hi"');
    expect(readValue(mem, 60, parseCType('double', none)!)).toBe('?');
  });
});

describe('instrument', () => {
  it('inserts traces before statements and braces around single-statement bodies', () => {
    const src = 'int main(void) {\n  int x = 1;\n  if (x)\n    x = 2;\n  return x;\n}\n';
    const at = (s: string, from = 0) => src.indexOf(s, from);
    const loc = (o: number, tokLen = 1) => ({ offset: o, tokLen });
    // A hand-written fragment of clang's JSON AST for `src`.
    const ast: AstNode = {
      inner: [
        {
          kind: 'FunctionDecl',
          name: 'main',
          loc: { offset: 4, file: 'main.c' },
          inner: [
            {
              kind: 'CompoundStmt',
              range: { begin: loc(at('{')), end: loc(at('}')) },
              inner: [
                {
                  kind: 'DeclStmt',
                  range: { begin: loc(at('int x')), end: loc(at(';')) },
                  inner: [{ kind: 'VarDecl', name: 'x', type: { qualType: 'int' } }],
                },
                {
                  kind: 'IfStmt',
                  range: { begin: loc(at('if')), end: loc(at('2')) },
                  inner: [
                    {
                      kind: 'ImplicitCastExpr',
                      range: { begin: loc(at('x)')), end: loc(at('x)')) },
                    },
                    {
                      kind: 'BinaryOperator',
                      range: { begin: loc(at('x = 2')), end: loc(at('2')) },
                    },
                  ],
                },
                {
                  kind: 'ReturnStmt',
                  range: { begin: loc(at('return'), 6), end: loc(at('x;', at('return'))) },
                },
              ],
            },
          ],
        },
      ],
    };
    const r = instrument(src, ast);
    const body = r.code.slice(r.code.indexOf('#line 1 "main.c"\n') + 17);
    expect(body.split('\n')).toHaveLength(src.split('\n').length);
    expect(body).toContain('__oslab_step(0, 2);int x = 1;');
    expect(body).toContain('{__oslab_step(0, 4);__oslab_var(0, &x);x = 2;}');
    expect(body).toContain('__oslab_step(0, 5);__oslab_var(0, &x);return x;');
    expect(body).toContain('__oslab_step(0, 6);__oslab_var(0, &x);}');
    expect(r.functions).toEqual(['main']);
  });
});

describe('wasi', () => {
  it('reads stdin in chunks and reports end of file', () => {
    const wasi = new Wasi({ stdin: 'abc', stdout: () => {}, stderr: () => {} });
    const memory = new WebAssembly.Memory({ initial: 1 });
    wasi.memory = memory;
    const v = new DataView(memory.buffer);
    v.setUint32(0, 100, true); // iov.buf
    v.setUint32(4, 2, true); // iov.len
    const read = wasi.imports().fd_read as (
      fd: number,
      iovs: number,
      n: number,
      out: number,
    ) => number;
    expect(read(0, 0, 1, 50)).toBe(0);
    expect(v.getUint32(50, true)).toBe(2);
    expect(read(0, 0, 1, 50)).toBe(0);
    expect(v.getUint32(50, true)).toBe(1);
    expect(read(0, 0, 1, 50)).toBe(0);
    expect(v.getUint32(50, true)).toBe(0);
    expect(new TextDecoder().decode(new Uint8Array(memory.buffer, 100, 1))).toBe('c');
  });
});
