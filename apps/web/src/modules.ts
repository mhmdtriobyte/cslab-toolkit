import type { IconName, ModuleProps } from '@oslab/core';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface ModuleEntry {
  /** Route path and examples folder name. */
  id: string;
  title: string;
  summary: string;
  topics: string[];
  icon: IconName;
  Component: LazyExoticComponent<ComponentType<ModuleProps>>;
}

export interface Course {
  /** Route: /course/<id>. */
  id: string;
  title: string;
  /** Label in the header navigation. */
  short: string;
  /**
   * Course code(s) shown next to the title, e.g. "CSCI430L". Leave undefined until confirmed:
   * this is the only place to edit when codes change.
   */
  code?: string;
  blurb: string;
  modules: ModuleEntry[];
}

const dsa = () => import('@oslab/sim-dsa');

export const courses: Course[] = [
  {
    id: 'os',
    short: 'OS',
    title: 'Operating Systems',
    code: 'CSCI430L',
    blurb:
      'Processes, scheduling, deadlock, threads and memory: the OS lab from fork() to page replacement.',
    modules: [
      {
        id: 'shell',
        title: 'Linux terminal',
        summary:
          'A safe, simulated Linux shell with guided missions: files, permissions, pipes, processes and shell scripts.',
        topics: ['ls / cd', 'chmod', 'pipes', 'ps / kill', 'bash scripts'],
        icon: 'terminal',
        Component: lazy(() => import('@oslab/sim-shell').then((m) => ({ default: m.Module }))),
      },
      {
        id: 'fork',
        title: 'Fork visualizer',
        summary:
          'Paste C code with fork(), wait() and sleep(). See the process tree, every possible output, zombies and orphans.',
        topics: ['fork', 'getpid', 'wait', 'zombie', 'orphan', 'ps / kill'],
        icon: 'tree',
        Component: lazy(() =>
          import('@oslab/fork-visualizer').then((m) => ({ default: m.Module })),
        ),
      },
      {
        id: 'scheduling',
        title: 'CPU scheduling',
        summary:
          'FCFS, SJF, SRTF, Priority and Round Robin with an animated Gantt chart, ready queue, metrics and a compare mode.',
        topics: ['Gantt chart', 'waiting time', 'turnaround', 'preemption', 'time quantum'],
        icon: 'chart',
        Component: lazy(() => import('@oslab/sim-scheduling').then((m) => ({ default: m.Module }))),
      },
      {
        id: 'deadlock',
        title: 'Deadlock',
        summary:
          "Draw resource allocation graphs, run the Banker's safety and request algorithms, and detect deadlocks step by step.",
        topics: ['RAG', "Banker's algorithm", 'safe sequence', 'detection'],
        icon: 'lock',
        Component: lazy(() => import('@oslab/sim-deadlock').then((m) => ({ default: m.Module }))),
      },
      {
        id: 'threads',
        title: 'Threads',
        summary:
          'Race conditions, mutexes, semaphores and condition variables. Explore every interleaving or be the scheduler.',
        topics: [
          'race condition',
          'mutex',
          'semaphore',
          'producer-consumer',
          'dining philosophers',
        ],
        icon: 'threads',
        Component: lazy(() => import('@oslab/sim-threads').then((m) => ({ default: m.Module }))),
      },
      {
        id: 'memory',
        title: 'Memory',
        summary:
          "Page replacement (FIFO, LRU, Optimal, Clock) with Belady's anomaly, and first, best and worst fit allocation.",
        topics: ['page faults', 'LRU', "Belady's anomaly", 'fragmentation'],
        icon: 'memory',
        Component: lazy(() => import('@oslab/sim-memory').then((m) => ({ default: m.Module }))),
      },
    ],
  },
  {
    id: 'programming',
    short: 'C & Python',
    title: 'Programming in C and Python',
    blurb:
      'Write, run and step through real programs. The tracer shows every line with the variables of every function call.',
    modules: [
      {
        id: 'runner',
        title: 'Code runner',
        summary:
          'Real Python 3.14 and real C (clang 22) in the browser, with keyboard input, compiler messages and a line-by-line tracer.',
        topics: ['Python', 'C', 'scanf / input()', 'call stack', 'arrays & pointers'],
        icon: 'code',
        Component: lazy(() => import('@oslab/runner').then((m) => ({ default: m.Module }))),
      },
      {
        id: 'manual',
        title: 'Manual',
        summary:
          'C and Python syntax side by side: types, input and output, loops, functions, arrays, strings, pointers, structs and more.',
        topics: ['syntax', 'printf / print', 'pointers', 'lists & dicts', 'malloc'],
        icon: 'book',
        Component: lazy(() => import('@oslab/runner').then((m) => ({ default: m.ManualModule }))),
      },
    ],
  },
  {
    id: 'dsa',
    short: 'Data structures',
    title: 'Data Structures and Algorithms',
    blurb:
      'Sorting, searching, trees, heaps, hash tables and graph algorithms, animated step by step with the counts that matter.',
    modules: [
      {
        id: 'sorting',
        title: 'Sorting & searching',
        summary:
          'Bubble, selection, insertion, merge, quick and heap sort with comparison and swap counts. Linear and binary search.',
        topics: ['O(n²) vs O(n log n)', 'stability', 'partition', 'binary search'],
        icon: 'bars',
        Component: lazy(() => dsa().then((m) => ({ default: m.SortingModule }))),
      },
      {
        id: 'structures',
        title: 'Trees, heaps & hashing',
        summary:
          'BST insert, delete and traversals, AVL rotations, min/max heaps as a tree and an array, and hash tables.',
        topics: ['BST', 'AVL', 'heap', 'linear probing', 'chaining'],
        icon: 'binaryTree',
        Component: lazy(() => dsa().then((m) => ({ default: m.StructuresModule }))),
      },
      {
        id: 'graphs',
        title: 'Graph algorithms',
        summary:
          'BFS, DFS, Dijkstra, Prim, Kruskal and topological sort on a graph you type, with the queue and distance table.',
        topics: ['BFS / DFS', 'shortest paths', 'MST', 'topological order'],
        icon: 'graph',
        Component: lazy(() => dsa().then((m) => ({ default: m.GraphsModule }))),
      },
    ],
  },
  {
    id: 'databases',
    short: 'Databases',
    title: 'Databases',
    blurb:
      'Real SQLite in the browser with sample databases, a schema browser and exercises that check your answer.',
    modules: [
      {
        id: 'sql',
        title: 'SQL playground',
        summary:
          'Query university, company and shop databases. Joins, GROUP BY, subqueries, constraints and transactions, with auto-checked exercises.',
        topics: ['SELECT', 'JOIN', 'GROUP BY', 'subqueries', 'constraints'],
        icon: 'database',
        Component: lazy(() => import('@oslab/sim-sql').then((m) => ({ default: m.Module }))),
      },
    ],
  },
];

export const modules: ModuleEntry[] = courses.flatMap((c) => c.modules);

export function courseOf(moduleId: string): Course | undefined {
  return courses.find((c) => c.modules.some((m) => m.id === moduleId));
}
