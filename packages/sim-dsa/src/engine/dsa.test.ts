import { rng } from '@oslab/core/engine';
import { describe, expect, it } from 'vitest';
import {
  graphSteps,
  hashSteps,
  heapSteps,
  inorderKeys,
  parseGraph,
  parseHashOps,
  parseHeapOps,
  parseNumbers,
  parseTreeOps,
  SORT_ALGORITHMS,
  searchSteps,
  sortSteps,
  treeSteps,
  type Graph,
  type GraphState,
  type TreeNode,
  type TreeOp,
} from '.';

const last = <T>(xs: readonly T[]) => xs[xs.length - 1] as T;

describe('sorting', () => {
  it('every algorithm sorts random arrays, including duplicates and negatives', () => {
    const r = rng(7);
    for (let t = 0; t < 300; t++) {
      const n = r.int(0, 18);
      const values = Array.from({ length: n }, () => r.int(-20, 20));
      const expected = [...values].sort((a, b) => a - b);
      for (const { value } of SORT_ALGORITHMS) {
        const res = sortSteps(values, value);
        expect(last(res.steps).state.array, `${value} ${values}`).toEqual(expected);
        expect(last(res.steps).state.sorted).toHaveLength(n);
      }
    }
  });

  it('counts textbook comparisons', () => {
    // Bubble sort with early exit on a sorted array: one pass of n-1 comparisons, no swaps.
    expect(sortSteps([1, 2, 3, 4, 5], 'bubble')).toMatchObject({ comparisons: 4, moves: 0 });
    // Selection sort always does n(n-1)/2 comparisons.
    expect(sortSteps([5, 4, 3, 2, 1], 'selection').comparisons).toBe(10);
    // Insertion sort on a reversed array: n(n-1)/2 comparisons and swaps.
    expect(sortSteps([5, 4, 3, 2, 1], 'insertion')).toMatchObject({ comparisons: 10, moves: 10 });
    expect(sortSteps([1, 2, 3, 4, 5], 'insertion')).toMatchObject({ comparisons: 4, moves: 0 });
  });

  it('parses number lists', () => {
    expect(parseNumbers('5, 3 -1  8')).toEqual([5, 3, -1, 8]);
    expect(parseNumbers('5 x')).toBeNull();
    expect(parseNumbers('')).toBeNull();
  });
});

describe('searching', () => {
  it('binary search agrees with indexOf on sorted arrays', () => {
    const r = rng(3);
    for (let t = 0; t < 300; t++) {
      const values = [...new Set(Array.from({ length: r.int(0, 20) }, () => r.int(0, 40)))].sort(
        (a, b) => a - b,
      );
      const target = r.int(-2, 42);
      const res = searchSteps(values, target, 'binary');
      const idx = values.indexOf(target);
      expect(res.found).toBe(idx === -1 ? null : idx);
      expect(res.comparisons).toBeLessThanOrEqual(Math.floor(Math.log2(values.length || 1)) + 1);
      expect(searchSteps(values, target, 'linear').found).toBe(idx === -1 ? null : idx);
    }
  });
});

function checkBst(n: TreeNode | null, lo = -Infinity, hi = Infinity): boolean {
  if (!n) return true;
  return n.key > lo && n.key < hi && checkBst(n.left, lo, n.key) && checkBst(n.right, n.key, hi);
}

function avlOk(n: TreeNode | null): number {
  if (!n) return 0;
  const l = avlOk(n.left);
  const r = avlOk(n.right);
  if (l < 0 || r < 0 || Math.abs(l - r) > 1) return -1;
  return 1 + Math.max(l, r);
}

describe('trees', () => {
  it('BST and AVL keep the same keys as a set, AVL stays balanced', () => {
    const r = rng(11);
    for (let t = 0; t < 200; t++) {
      const ops: TreeOp[] = [];
      const set = new Set<number>();
      for (let k = 0; k < 30; k++) {
        const key = r.int(1, 25);
        if (r.int(0, 2) === 0) {
          ops.push({ op: 'delete', key });
          set.delete(key);
        } else {
          ops.push({ op: 'insert', key });
          set.add(key);
        }
      }
      const expected = [...set].sort((a, b) => a - b);
      for (const kind of ['bst', 'avl'] as const) {
        const root = last(treeSteps(ops, kind)).state.root;
        expect(inorderKeys(root)).toEqual(expected);
        expect(checkBst(root)).toBe(true);
        if (kind === 'avl') expect(avlOk(root)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('traversals match the textbook tree', () => {
    const ops = parseTreeOps(
      'insert 50 30 70 20 40 60 80; preorder; inorder; postorder; levelorder',
    );
    expect(typeof ops).not.toBe('string');
    const steps = treeSteps(ops as TreeOp[], 'bst');
    const outputs = steps
      .filter((s) => /traversal\.$|: [\d, ]+\.$/.test(s.label) && s.state.visited.length === 7)
      .map((s) => s.state.visited.join(' '));
    expect(outputs).toContain('50 30 20 40 70 60 80');
    expect(outputs).toContain('20 30 40 50 60 70 80');
    expect(outputs).toContain('20 40 30 60 80 70 50');
    expect(outputs).toContain('50 30 70 20 40 60 80');
  });

  it('AVL inserting 1..7 in order gives a perfect tree rooted at 4', () => {
    const ops = parseTreeOps('insert 1 2 3 4 5 6 7') as TreeOp[];
    const root = last(treeSteps(ops, 'avl')).state.root;
    expect(root?.key).toBe(4);
    expect(root?.height).toBe(3);
  });

  it('rejects bad commands', () => {
    expect(parseTreeOps('jump 4')).toMatch(/Unknown command/);
    expect(parseTreeOps('insert x')).toMatch(/not a whole number/);
  });
});

describe('heap', () => {
  it('extracts in sorted order (heap sort by priority queue)', () => {
    const r = rng(5);
    for (let t = 0; t < 100; t++) {
      const values = Array.from({ length: r.int(1, 25) }, () => r.int(-50, 50));
      const text = `insert ${values.join(' ')}; extract ${values.length}`;
      const ops = parseHeapOps(text);
      expect(typeof ops).not.toBe('string');
      for (const kind of ['min', 'max'] as const) {
        const steps = heapSteps(ops as never, kind);
        const out = last(steps).state.extracted;
        const sorted = [...values].sort((a, b) => (kind === 'min' ? a - b : b - a));
        expect(out).toEqual(sorted);
        // The heap property holds at the end of every operation.
        steps.forEach((s, i) => {
          const next = steps[i + 1];
          if (next && !/^(Insert|Extract)/.test(next.label)) return;
          const h = s.state.heap;
          for (let k = 1; k < h.length; k++) {
            const p = h[Math.floor((k - 1) / 2)] as number;
            expect(kind === 'min' ? p <= (h[k] as number) : p >= (h[k] as number)).toBe(true);
          }
        });
      }
    }
  });
});

describe('hashing', () => {
  it('agrees with a Set for random insert/search/delete', () => {
    const r = rng(9);
    for (const method of ['chaining', 'linear', 'quadratic', 'double'] as const) {
      for (let t = 0; t < 60; t++) {
        const m = 11;
        const set = new Set<number>();
        const lines: string[] = [];
        const checks: { step: number; key: number; present: boolean }[] = [];
        for (let k = 0; k < 14; k++) {
          const key = r.int(0, 60);
          const op = (['insert', 'insert', 'search', 'delete'] as const)[r.int(0, 3)];
          // Keep the load factor below 1/2 so quadratic probing always finds a slot.
          if (op === 'insert' && set.size >= 5 && !set.has(key)) continue;
          lines.push(`${op} ${key}`);
          if (op === 'insert') set.add(key);
          if (op === 'delete') set.delete(key);
          if (op === 'search') checks.push({ step: lines.length - 1, key, present: set.has(key) });
        }
        const ops = parseHashOps(lines.join('\n'));
        expect(typeof ops).not.toBe('string');
        const steps = hashSteps(ops as never, m, method);
        const final = last(steps).state;
        expect(final.count).toBe(set.size);
        const stored =
          method === 'chaining'
            ? (final.slots as number[][]).flat()
            : final.slots.filter((v): v is number => typeof v === 'number');
        expect([...stored].sort((a, b) => a - b)).toEqual([...set].sort((a, b) => a - b));
        void checks;
      }
    }
  });

  it('linear probing textbook example', () => {
    const steps = hashSteps(parseHashOps('insert 18 41 22 44 59 32 31 73') as never, 13, 'linear');
    expect(last(steps).state.slots).toEqual([
      null,
      null,
      41,
      null,
      null,
      18,
      44,
      59,
      32,
      22,
      31,
      73,
      null,
    ]);
  });
});

function bellmanFord(g: Graph, s: string): Record<string, number | null> {
  const d: Record<string, number | null> = Object.fromEntries(g.nodes.map((n) => [n, null]));
  d[s] = 0;
  const edges = g.directed
    ? g.edges
    : [...g.edges, ...g.edges.map((e) => ({ ...e, from: e.to, to: e.from }))];
  for (let i = 0; i < g.nodes.length; i++) {
    for (const e of edges) {
      const du = d[e.from];
      if (du === null || du === undefined) continue;
      const alt = du + e.weight;
      if (d[e.to] === null || alt < (d[e.to] as number)) d[e.to] = alt;
    }
  }
  return d;
}

function randomGraph(r: ReturnType<typeof rng>, directed: boolean): Graph {
  const n = r.int(2, 8);
  const names = 'ABCDEFGH'.slice(0, n).split('');
  const lines = names.map((x) => x);
  for (let k = 0; k < r.int(1, 14); k++) {
    const a = names[r.int(0, n - 1)] as string;
    const b = names[r.int(0, n - 1)] as string;
    if (a !== b) lines.push(`${a} ${b} ${r.int(1, 9)}`);
  }
  return parseGraph(lines.join('\n'), directed) as Graph;
}

describe('graphs', () => {
  const final = (g: Graph, a: Parameters<typeof graphSteps>[1], s = 'A') =>
    last(graphSteps(g, a, s) as { state: GraphState }[]).state;

  it('Dijkstra matches Bellman-Ford', () => {
    const r = rng(21);
    for (let t = 0; t < 300; t++) {
      const g = randomGraph(r, r.int(0, 1) === 1);
      expect(final(g, 'dijkstra').dist).toEqual(bellmanFord(g, 'A'));
    }
  });

  it('BFS distances are hop counts', () => {
    const r = rng(22);
    for (let t = 0; t < 300; t++) {
      const g = randomGraph(r, r.int(0, 1) === 1);
      const unit = { ...g, edges: g.edges.map((e) => ({ ...e, weight: 1 })) };
      expect(final(g, 'bfs').dist).toEqual(bellmanFord(unit, 'A'));
    }
  });

  it('Prim and Kruskal find the same MST weight', () => {
    const r = rng(23);
    for (let t = 0; t < 300; t++) {
      const g = randomGraph(r, false);
      const weight = (s: GraphState) =>
        s.tree.reduce((acc, i) => acc + (g.edges[i]?.weight ?? 0), 0);
      const k = final(g, 'kruskal');
      const p = final(g, 'prim');
      // Prim only spans A's component; compare when the graph is connected.
      if (k.tree.length === g.nodes.length - 1) {
        expect(p.tree).toHaveLength(g.nodes.length - 1);
        expect(weight(p)).toBe(weight(k));
      }
    }
  });

  it('topological order respects every edge, or reports a cycle', () => {
    const r = rng(24);
    for (let t = 0; t < 300; t++) {
      const g = randomGraph(r, true);
      const steps = graphSteps(g, 'topo', 'A') as { label: string; state: GraphState }[];
      const s = last(steps);
      if (s.state.order.length === g.nodes.length) {
        const pos = new Map(s.state.order.map((n, i) => [n, i]));
        for (const e of g.edges) expect(pos.get(e.from)).toBeLessThan(pos.get(e.to) as number);
      } else expect(s.label).toMatch(/Cycle/);
    }
  });

  it('DFS visits textbook order with alphabetical neighbours', () => {
    const g = parseGraph('A B\nA C\nB D\nC D\nD E', false) as Graph;
    expect(final(g, 'dfs').order).toEqual(['A', 'B', 'D', 'C', 'E']);
    expect(final(g, 'bfs').order).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('validates input', () => {
    expect(parseGraph('A B x', false)).toMatch(/weight/);
    expect(parseGraph('', false)).toMatch(/at least one/);
    expect(graphSteps(parseGraph('A B -1', true) as Graph, 'dijkstra', 'A')).toMatch(
      /non-negative/,
    );
    expect(graphSteps(parseGraph('A B 1', true) as Graph, 'prim', 'A')).toMatch(/undirected/);
  });
});
