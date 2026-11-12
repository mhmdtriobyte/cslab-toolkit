# Architecture

CS Lab Toolkit is a static, client-side web app. Operating-system behaviour, data structures and
graph algorithms are simulated in TypeScript in the browser; SQL runs on real SQLite (sql.js, bundled)
and the code runner uses real CPython (Pyodide) and real clang, both compiled to WebAssembly. There
is no backend.

## Packages

| Package                    | Contents                                                                    |
| -------------------------- | --------------------------------------------------------------------------- |
| `apps/web`                 | Vite + React shell: router, home page, module launcher, PWA setup           |
| `packages/core`            | Pure utilities (`@oslab/core/engine`) and the shared UI kit (`@oslab/core`) |
| `packages/fork-visualizer` | C-subset compiler + process VM, interleaving explorer, quiz generator, UI   |
| `packages/sim-scheduling`  | CPU scheduling algorithms, compare mode, Gantt UI                           |
| `packages/sim-deadlock`    | Resource allocation graphs, Banker's algorithm, detection algorithm         |
| `packages/sim-threads`     | Mini-assembly thread VM, mutex/semaphore/condition variables, explorer      |
| `packages/sim-memory`      | Page replacement and contiguous memory allocation                           |
| `packages/sim-dsa`         | Sorting, searching, BST/AVL, heaps, hash tables, graph algorithms (3 tools) |
| `packages/sim-sql`         | SQLite in a worker, sample databases, schema browser, exercise checking     |
| `packages/runner`          | Python and C runner: Pyodide and clang workers, WASI runtime, C tracer      |
| `examples/<module>/*.json` | Presets, loaded by the web app and passed to modules                        |

Each module package exports:

- `engine` - pure logic (also available as the `@oslab/<pkg>/engine` subpath). Engines never import
  React; an ESLint rule (`no-restricted-imports` on `**/engine/**`) enforces it.
- `Module` - the React component the web app lazy-loads.

Packages are consumed as TypeScript source (`exports` points at `src/`), so there is no per-package
build step: Vite compiles everything for the app, Vitest runs tests directly and `tsc --noEmit`
type-checks each package.

## The engine / step contract

Every engine turns an input into an immutable array of steps:

```ts
interface Step<S> {
  state: S; // full snapshot after this step (never mutated afterwards)
  label: string; // one-line human description ("P1001 forks P1002")
}
type Trace<S> = Step<S>[];
```

`StepPlayer` (in `@oslab/core`) only knows the number of steps and the current index: play, pause,
step forward/back, reset and a speed slider all just move the index. A module renders
`trace[index].state`. Because the snapshots are immutable, stepping backwards is free and a module can
branch from any step (for example the fork module's "kill this process" button builds a new trace that
shares the prefix of the old one).

Snapshots use structural sharing: a step copies only the objects it changes (for the fork VM, the
process that ran one statement), so long traces stay cheap.

## Shared utilities (`@oslab/core/engine`)

- `rng(seed)` - mulberry32 seedable PRNG. Every "random" button in the toolkit takes a seed, so a
  shared link reproduces the same exercise.
- `explore(spec)` - generic exhaustive interleaving explorer used by the fork and threads modules.
  A spec gives `initial`, `choices(state)`, `apply(state, choice) -> { next, emit }`, `key(state)` and
  `outcome(state)` for terminal states. The explorer does a memoised DFS: for each state it computes the
  map _future output -> number of interleavings_ (the past output is not part of the key, so states
  reached through different histories are shared). It stops at `maxStates` (default 50 000) and reports
  that the result is partial. A cycle on the current DFS path (an infinite loop) yields the outcome
  `"... (does not terminate)"`. Example traces are rebuilt afterwards by walking the memo table, so only
  one successor per output is stored. Each state keeps at most `maxOutcomes` (default 500) distinct
  outputs: programs such as three unconditional `fork()` calls followed by a `printf` of PIDs have
  hundreds of thousands of orderings, and keeping them all took tens of seconds and could not be shown
  anyway. Hitting the cap sets `outcomesCapped` and the UI says that only some outputs are listed.
  Both modules run the explorer in a Web Worker (`useWorkerJob`) so the page stays responsive and
  the search can be cancelled.
- `encodeState / decodeState` - lz-string `compressToEncodedURIComponent` of the JSON module input.

The React half of `@oslab/core` holds `StepPlayer`, `useSharedInput`, `ModuleHeader` (examples menu,
share link, export/import JSON), `OutcomeList` (results of an exhaustive exploration), the theme and
presentation-mode provider, `useWorkerJob` (runs a long computation in a Web Worker), and small primitives (`Panel`, `Button`, `Tabs`, `Alert`, `seriesColor`…).

## Shareable links and examples

URLs look like `/fork#s=<lz-string>` or `/fork#ex=orphan`. `useSharedInput(moduleId, examples, fallback)`
in `@oslab/core` reads the hash once on load, and every input change rewrites the hash with
`history.replaceState` (no history spam). The share bar copies the URL and offers Export/Import JSON
of the same input object.

Examples are JSON files `examples/<module>/<id>.json`:

```json
{ "id": "orphan", "title": "Orphan demo", "description": "...", "input": { ... } }
```

The web app loads them with `import.meta.glob` at build time (so they are cached by the PWA) and passes
the list to the module as a prop.

## Fork visualizer design

1. **Tokenizer** (`lexer.ts`) - C tokens with line/column, `//` and `/* */` comments, `#include`
   (ignored) and simple `#define NAME <integer>`.
2. **Parser** (`parser.ts`) - recursive descent to an AST with source lines. Anything outside the subset
   raises a `CError` with a friendly message and the line ("arrays are not supported yet"). Supported:
   `int`/`pid_t`/`long`/`unsigned`/`short` scalars, functions with `int` parameters (including
   recursion), `if/else`, `while`, `do-while`, `for`, `break`, `continue`, `return`, all integer
   operators, `?:`, compound assignment, `++/--`.
3. **Compiler** (`compiler.ts`) - AST to a small stack bytecode. Variables are resolved to frame slots
   at compile time (block scoping and shadowing are handled there). Each statement starts with a
   `STMT line` instruction; one _atomic step_ runs a process from one `STMT` to the next, so a
   `printf` is atomic and `fork()` inside an expression (`fork() && fork()`) works naturally: the child
   is a copy of the parent's frames and operand stack, with `0` pushed instead of the pid.
4. **VM** (`vm.ts`) - the system state: processes (pid, ppid, state, pc, call stack, operand stack,
   exit code, wake time), the virtual clock, the next pid and the stdout log. `step(system, pid)` returns
   a new system. Rules:
   - PIDs are sequential from `pidStart` (default 1000). PID 1 is `init`, the program is started by a
     simulated `bash` (pid `shellPid`, default 900) that waits for it.
   - `fork()` returns 0 / child pid / -1 (when the optional "fork fails after N" limit is reached).
   - A process that exits becomes a **zombie** until its parent waits; if the parent is already gone
     the child was re-parented to init, which reaps immediately.
   - When a process exits, its children are **re-parented to PID 1** and marked as orphans.
   - `sleep(n)` moves the process to `sleeping` until `clock + n`. The clock only advances when no
     process is ready (it jumps to the earliest wake-up), so sleep imposes the ordering students expect.
   - `wait`/`waitpid` block while the caller has living children and none is a zombie; with no
     children they return -1. `wait(&status)` stores `exit_code << 8`; `WEXITSTATUS`/`WIFEXITED` work.
   - Runtime errors (division by zero, step limit) kill the offending process like a signal would.
   - stdout is unbuffered: every `printf` appears immediately. (Real `printf` without `\n` before a
     `fork()` can be duplicated by stdio buffering; this is out of scope and mentioned in the UI help.)
5. **Schedulers** - deterministic policies (`parent-first`, `child-first`, `round-robin`) keep a ready
   queue outside the system state; manual mode lets the user choose the pid; exhaustive mode feeds the
   VM to `explore()` with "which ready process runs next" as the choice.
6. **Quiz** - a seeded template generator nests `fork()` in sequences, `if`, loops and `&&`/`||`, then
   uses the engine (deterministic run for counts, exhaustive run for "which output is possible") to
   compute answers.

## Courses

`apps/web/src/modules.ts` groups modules into courses (`courses`), each with an optional course
`code`. The header shows one link per course, `/course/<id>` lists its tools and examples, and every
module page shows a breadcrumb. Module routes (`/fork`, `/sql`...) never change, so old links keep
working when modules move between courses.

## Code runner design

- **Python**: Pyodide (CPython 3.14 in WebAssembly) is imported inside a module worker on the first
  run. `pythonHarness.ts` wraps the student's code: `input()` reads the Input box and
  echoes like a terminal, tracebacks are trimmed to the student's frames, and Step through uses
  `sys.settrace` to record every line with each frame's locals (capped at 2000 steps).
- **C**: `@yowasp/clang` (clang + lld + wasi-libc in WebAssembly) compiles to `wasm32-wasi`, and
  `wasi.ts` is a small WASI runtime (stdin string, stdout/stderr callbacks, clock, random; no files).
  stdout is reported as a terminal, so libc line-buffers it exactly like a real shell.
- **C tracing**: clang's JSON AST gives every statement's offset and the variables in scope.
  `cTrace.ts` inserts `__oslab_step(fn, line)` and `__oslab_var(id, &x)` calls before each statement
  (adding braces around single-statement bodies, with a `cleanup` attribute to track returns), then
  recompiles the copy at `-O0`. JavaScript decodes values straight from WebAssembly memory using the
  wasm32 layout (ILP32), so arrays, structs, `char[]` strings and pointers show their real contents.
  Inserted text never adds lines, so line numbers stay correct.
- Both toolchains are npm dependencies of `packages/runner`. `apps/web/toolchains.ts` (a Vite plugin)
  serves them at `/toolchains/pyodide/` and `/toolchains/clang/` in dev and copies them into
  `dist/toolchains/` on build, so the app never calls a CDN. They are not precached (about 12 MB and
  105 MB uncompressed); the service worker caches them (`toolchains` cache) on first use. Runs stop after 10 s (20 s when tracing).
- The full C pipeline is checked with plain `node` against a local copy of the compiler, not in CI:
  Vitest's worker crashes when it loads the 100 MB toolchain. The pure parts (types, memory decoding,
  instrumentation, WASI stdin) have unit tests.

## Taste decisions (chosen for simplicity)

- **CodeMirror 6** instead of Monaco: smaller, works offline in the PWA without workers.
- **Tailwind v4** via `@tailwindcss/vite`; dark mode is a `.dark` class on `<html>`, presentation mode a
  `.presentation` class that scales the root font size and raises contrast.
- **React Flow (`@xyflow/react`)** with our own tidy-tree layout (no dagre dependency).
- **React Router** with `BrowserRouter`; `vercel.json` rewrites every route to `index.html`.
- Tie-breaking rules for scheduling: FCFS by arrival then input order; SJF/SRTF by (remaining) burst,
  then arrival, then input order, and a running process is not preempted by an equal one; Priority uses
  lower number = higher priority by default (toggle), ties by arrival then input order; Round Robin adds
  processes that arrive at time _t_ to the queue before the process preempted at _t_. CPU utilisation is
  busy time / (last completion - first arrival).
- Banker's / detection algorithms scan processes in index order, repeatedly, until a full pass makes no
  progress (this gives `<P1, P3, P4, P0, P2>` on the classic Silberschatz example).
- MLFQ is not implemented yet; the scheduling `Algorithm` interface is designed so it can be added as one
  more entry in the registry.
