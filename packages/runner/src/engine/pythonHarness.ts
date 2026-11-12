import { MAX_TRACE_STEPS } from './protocol';

/**
 * Python run inside Pyodide around the student's program. It wires stdin/stdout to the page,
 * runs the code as "main.py" in a fresh namespace, and optionally records a sys.settrace trace.
 * Inputs come in as globals: _student_code, _student_stdin, _want_trace, _emit_out, _emit_err.
 */
export const PYTHON_HARNESS = `
import sys, io, json, types, traceback, builtins

_MAX = ${MAX_TRACE_STEPS}
_FILE = '<student>'

class _Out(io.TextIOBase):
    def __init__(self, cb):
        self.cb = cb
        self.n = 0
    def writable(self):
        return True
    def write(self, s):
        s = str(s)
        self.n += len(s)
        self.cb(s)
        return len(s)
    def flush(self):
        pass

_out = _Out(_emit_out)
_err = _Out(_emit_err)
sys.stdout = _out
sys.stderr = _err
sys.stdin = io.StringIO(_student_stdin)

def _input(prompt=''):
    _out.write(str(prompt))
    line = sys.stdin.readline()
    if not line:
        raise EOFError('EOF when reading a line (type more lines in the Input box)')
    line = line.rstrip('\\n')
    _out.write(line + '\\n')
    return line

builtins.input = _input

def _short(v):
    try:
        r = repr(v)
    except Exception:
        r = '<unprintable>'
    return r if len(r) <= 160 else r[:157] + '...'

def _vars(f):
    out = []
    for k, v in list(f.f_locals.items()):
        if k.startswith('__') and k.endswith('__'):
            continue
        if isinstance(v, types.ModuleType):
            continue
        if isinstance(v, types.FunctionType):
            val = 'function ' + v.__name__ + '(...)'
        elif isinstance(v, type):
            val = 'class ' + v.__name__
        else:
            val = _short(v)
        out.append({'name': k, 'value': val, 'type': type(v).__name__})
    return out

def _stack(frame):
    st = []
    f = frame
    while f is not None:
        if f.f_code.co_filename == _FILE:
            name = f.f_code.co_name
            st.append({'func': 'global' if name == '<module>' else name, 'line': f.f_lineno, 'vars': _vars(f)})
        f = f.f_back
    st.reverse()
    return st

class _TraceLimit(BaseException):
    pass

_steps = []

def _tracer(frame, event, arg):
    if frame.f_code.co_filename != _FILE:
        return None
    if event not in ('line', 'call', 'return', 'exception'):
        return _tracer
    if event == 'call' and frame.f_code.co_name == '<module>':
        return _tracer
    if len(_steps) >= _MAX:
        raise _TraceLimit()
    detail = None
    if event == 'return':
        detail = _short(arg)
    elif event == 'exception':
        detail = arg[0].__name__ + ': ' + str(arg[1])
    _steps.append({'line': frame.f_lineno, 'event': event, 'stack': _stack(frame),
                   'stdoutLength': _out.n, 'detail': detail})
    return _tracer

def _run():
    exit_code = 0
    error = None
    truncated = False
    ns = {'__name__': '__main__', '__builtins__': builtins}
    try:
        code = compile(_student_code, _FILE, 'exec')
        if _want_trace:
            sys.settrace(_tracer)
        try:
            exec(code, ns)
        finally:
            sys.settrace(None)
    except _TraceLimit:
        truncated = True
    except SystemExit as e:
        exit_code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        if e.code is not None and not isinstance(e.code, int):
            _err.write(str(e.code) + '\\n')
    except SyntaxError as e:
        exit_code = 1
        msg = type(e).__name__ + ': ' + str(e.msg)
        _err.write('  File "main.py", line ' + str(e.lineno) + '\\n')
        if e.text:
            _err.write('    ' + e.text.strip() + '\\n')
        _err.write(msg + '\\n')
        error = {'message': msg, 'line': e.lineno}
    except BaseException as e:
        exit_code = 1
        frames = [fs for fs in traceback.extract_tb(e.__traceback__) if fs.filename == _FILE]
        lines = ['Traceback (most recent call last):\\n']
        for fs in frames:
            lines.append('  File "main.py", line ' + str(fs.lineno) + ', in ' + fs.name + '\\n')
            if fs.line:
                lines.append('    ' + fs.line.strip() + '\\n')
        msg = ''.join(traceback.format_exception_only(type(e), e)).strip()
        lines.append(msg + '\\n')
        _err.write(''.join(lines))
        error = {'message': msg, 'line': frames[-1].lineno if frames else None}
    return json.dumps({'exitCode': exit_code, 'error': error,
                       'trace': _steps if _want_trace else None, 'truncated': truncated})

_result = _run()
_result
`;
