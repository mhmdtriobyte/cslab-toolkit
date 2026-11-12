import {
  GRAPH_ALGORITHMS,
  HASH_METHODS,
  SORT_ALGORITHMS,
  type GraphAlgorithm,
  type HashMethod,
  type HeapKind,
  type SearchAlgorithm,
  type SortAlgorithm,
  type TreeKind,
} from '../engine';

const str = (v: unknown, fallback: string, max = 2000) =>
  typeof v === 'string' ? v.slice(0, max) : fallback;
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback;

// ---- Sorting & searching ----

export type SortTab = 'sort' | 'search';

export interface SortInput {
  tab: SortTab;
  values: string;
  algorithm: SortAlgorithm | 'compare';
  searchValues: string;
  target: number;
  search: SearchAlgorithm;
}

export const DEFAULT_SORT: SortInput = {
  tab: 'sort',
  values: '38 27 43 3 9 82 10',
  algorithm: 'bubble',
  searchValues: '3 9 10 27 38 43 55 61 70 82 90',
  target: 61,
  search: 'binary',
};

export function sanitizeSort(raw: unknown): SortInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    tab: oneOf(r.tab, ['sort', 'search'] as const, 'sort'),
    values: str(r.values, DEFAULT_SORT.values, 400),
    algorithm: oneOf(
      r.algorithm,
      [...SORT_ALGORITHMS.map((a) => a.value), 'compare' as const],
      'bubble',
    ),
    searchValues: str(r.searchValues, DEFAULT_SORT.searchValues, 400),
    target: int(r.target, -999999, 999999, DEFAULT_SORT.target),
    search: oneOf(r.search, ['linear', 'binary'] as const, 'binary'),
  };
}

// ---- Trees, heaps and hashing ----

export type StructTab = 'tree' | 'heap' | 'hash';

export interface StructInput {
  tab: StructTab;
  treeKind: TreeKind;
  treeOps: string;
  heapKind: HeapKind;
  heapOps: string;
  hashMethod: HashMethod;
  hashSize: number;
  hashOps: string;
}

export const DEFAULT_STRUCT: StructInput = {
  tab: 'tree',
  treeKind: 'bst',
  treeOps: 'insert 50 30 70 20 40 60 80\nsearch 60\ndelete 30\ninorder',
  heapKind: 'min',
  heapOps: 'insert 35 33 42 10 14 19 27 44 26 31\nextract 2',
  hashMethod: 'linear',
  hashSize: 13,
  hashOps: 'insert 18 41 22 44 59 32 31 73\nsearch 31\ndelete 44\nsearch 31',
};

export function sanitizeStruct(raw: unknown): StructInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    tab: oneOf(r.tab, ['tree', 'heap', 'hash'] as const, 'tree'),
    treeKind: oneOf(r.treeKind, ['bst', 'avl'] as const, 'bst'),
    treeOps: str(r.treeOps, DEFAULT_STRUCT.treeOps),
    heapKind: oneOf(r.heapKind, ['min', 'max'] as const, 'min'),
    heapOps: str(r.heapOps, DEFAULT_STRUCT.heapOps),
    hashMethod: oneOf(
      r.hashMethod,
      HASH_METHODS.map((m) => m.value),
      'linear',
    ),
    hashSize: int(r.hashSize, 2, 31, DEFAULT_STRUCT.hashSize),
    hashOps: str(r.hashOps, DEFAULT_STRUCT.hashOps),
  };
}

// ---- Graphs ----

export interface GraphInput {
  graph: string;
  directed: boolean;
  algorithm: GraphAlgorithm;
  start: string;
}

export const DEFAULT_GRAPH: GraphInput = {
  graph: 'A B 4\nA C 2\nB C 5\nB D 10\nC E 3\nE D 4\nD F 11',
  directed: false,
  algorithm: 'dijkstra',
  start: 'A',
};

export function sanitizeGraph(raw: unknown): GraphInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    graph: str(r.graph, DEFAULT_GRAPH.graph),
    directed: r.directed === true,
    algorithm: oneOf(
      r.algorithm,
      GRAPH_ALGORITHMS.map((a) => a.value),
      'bfs',
    ),
    start: str(r.start, 'A', 8),
  };
}
