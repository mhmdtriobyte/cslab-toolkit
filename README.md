# CS Lab Toolkit

**Open source, interactive tools for computer science courses.** Live at
**[ostoolkit.triobyte.tech](https://ostoolkit.triobyte.tech)**. Operating systems, programming in C and
Python, data structures and algorithms, and databases, all in the browser: no install, no account, no
server, and it keeps working offline once loaded.

It started as the toolkit for an Operating Systems lab (CSCI430L) and now covers the lab-heavy courses
of a computer science degree. It is neutral enough for any university to use or fork.

## Courses and tools

### Operating Systems (CSCI430L)

| Tool                | What students can do                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fork visualizer** | Paste C with `fork`, `getpid`, `getppid`, `wait`, `waitpid`, `sleep`, `exit`, `kill`. See the process tree, a `ps -af` table with a **kill** button, zombies and orphans re-parented to init. Run with a fixed scheduler, be the scheduler yourself, or **explore every interleaving** to list all possible outputs. Includes a fork **quiz** generator. |
| **CPU scheduling**  | FCFS, SJF, SRTF, Priority (preemptive or not) and Round Robin with an animated Gantt chart (idle gaps included), the ready queue at every time unit, waiting/turnaround/response times, CPU utilization, and a **compare all** mode that names the winner per metric.                                                                                    |
| **Deadlock**        | Banker's algorithm (Need, step-by-step safety algorithm with Work/Finish, resource-request algorithm), multi-instance deadlock detection, and a drag-and-drop **resource allocation graph** editor that detects cycles and only reports a deadlock when graph reduction confirms it.                                                                     |
| **Threads**         | A tiny atomic instruction set shown as pseudo-code. Race conditions (`counter++` losing updates), mutexes, semaphores, condition variables, producer-consumer, readers-writers and dining philosophers. Random, manual or exhaustive scheduling, with swimlanes and blocked markers.                                                                     |
| **Memory**          | Page replacement with FIFO, LRU, Optimal and Clock (frame table, faults, hit ratio, reference bits and hand), a **Belady's anomaly** chart, and first / best / worst fit allocation with frees, hole merging and external fragmentation.                                                                                                                 |

### Programming in C and Python

| Tool            | What students can do                                                                                                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code runner** | **Real Python 3.14** (Pyodide) and **real C** (clang 22) in the browser, with an Input box for `input()` / `scanf`, compiler warnings and errors on the right lines, and tracebacks. **Step through** replays the program line by line with every function's variables: lists and dicts in Python; arrays, structs, strings and pointers in C. |

### Data Structures and Algorithms

| Tool                       | What students can do                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sorting & searching**    | Bubble, selection, insertion, merge, quick (Lomuto) and heap sort as animated bars with comparison and swap counts, a **compare all** table, and linear vs binary search with lo / mid / hi.                                     |
| **Trees, heaps & hashing** | BST insert / delete (all three cases) / search and the four traversals, **AVL** with LL, RR, LR and RL rotations, min- and max-heaps as a tree and an array, and hash tables with chaining, linear, quadratic or double hashing. |
| **Graph algorithms**       | Type an edge list and run BFS, DFS, Dijkstra, Prim, Kruskal or topological sort step by step, with the queue, stack or priority queue and the distance table.                                                                    |

### Databases

| Tool               | What students can do                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQL playground** | **Real SQLite** with university, company and shop databases, a schema browser with keys, every result set of a script, foreign keys enforced, and **exercises** that check the answer against a hidden solution. |

The real Python and C toolchains are downloaded from jsDelivr the first time a student presses Run
(about 6 MB for Python, 27 MB for C) and then cached for offline use. Everything else is part of the
roughly 2 MB site.

## Use it in class

- **Examples menu.** Every tool has presets (Fork Example 1 and 2, the orphan exercise, textbook
  scheduling and Banker's examples, AVL rotations, Dijkstra, SQL exercises, C pointer bugs…). Each
  course page lists them all.
- **Share link.** Every input lives in the URL. Set up an exercise, press **Share link**, and paste the
  link in your LMS or chat: students open exactly that exercise. Links to presets look like
  `/fork#ex=orphan`.
- **Export / Import JSON.** Save an exercise as a file and load it later.
- **Presentation mode.** The header toggle enlarges text and contrast for projectors. Light and dark
  themes are available too.
- **Reproducible randomness.** Random tables and random thread schedules use a visible seed, so the
  same link always shows the same run.
- **Offline.** The site is a PWA: after the first visit it works without a network connection and can
  be installed like an app.

### The orphan exercise, step by step

1. Open **Fork visualizer → Examples → Exercise Part A: parent and child**.
2. Step forward until both processes are `sleeping` (parent and child are in `sleep(30)`).
3. Press **kill** next to the parent in the `ps -af` table.
4. Keep stepping: the child's PPID becomes **1** (re-parented to init) and it prints its new parent.

## Run locally

Requirements: Node.js 20+ and [pnpm](https://pnpm.io) 9.

```bash
pnpm i
```

```bash
pnpm dev
```

Then open http://localhost:5173. Other scripts:

| Command          | Does                                 |
| ---------------- | ------------------------------------ |
| `pnpm test`      | Unit tests (Vitest) for every engine |
| `pnpm lint`      | ESLint                               |
| `pnpm format`    | Prettier                             |
| `pnpm typecheck` | `tsc --noEmit` in every package      |
| `pnpm build`     | Production build in `apps/web/dist`  |

## Deploy to Vercel

The repository includes `vercel.json`, so importing it is enough:

1. Push the repository to GitHub (or your fork of it).
2. In Vercel, **Add New → Project**, import the repository and keep the defaults (Vercel reads the
   install/build commands and the `apps/web/dist` output directory from `vercel.json`).
3. Optionally set `VITE_REPO_URL` to your repository URL so the GitHub link in the header points to
   your fork.

Any static host works: build with `pnpm build` and serve `apps/web/dist`, rewriting unknown paths to
`index.html`.

## Add an example

Examples are plain JSON files in `examples/<module>/`. No code needed: see
[docs/adding-an-example.md](docs/adding-an-example.md).

## Project layout

```
apps/web/               Vite + React shell: courses, home page, router, PWA
packages/core/          Shared engine utilities (explorer, RNG, URL sharing) and UI kit
packages/fork-visualizer/
packages/sim-scheduling/
packages/sim-deadlock/
packages/sim-threads/
packages/sim-memory/
packages/sim-dsa/       Sorting, trees, heaps, hashing and graph algorithms
packages/sim-sql/       SQLite playground
packages/runner/        Python and C runner and tracer
examples/               JSON presets, one folder per module
docs/                   Architecture and contributor guides
```

Every module package exports a pure TypeScript `engine` (no React, fully unit-tested) and a React
`Module`. Read [docs/architecture.md](docs/architecture.md) for the design and
[docs/adding-a-module.md](docs/adding-a-module.md) to add a new simulator.

## Contributing

Bug reports, examples and new modules are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
