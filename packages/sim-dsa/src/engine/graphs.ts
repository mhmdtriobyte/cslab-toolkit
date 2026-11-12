import type { Step } from '@oslab/core/engine';

export interface Edge {
  from: string;
  to: string;
  weight: number;
}

export interface Graph {
  nodes: string[];
  edges: Edge[];
  directed: boolean;
}

export type GraphAlgorithm = 'bfs' | 'dfs' | 'dijkstra' | 'prim' | 'kruskal' | 'topo';

export const GRAPH_ALGORITHMS: { value: GraphAlgorithm; label: string; needsStart: boolean }[] = [
  { value: 'bfs', label: 'Breadth-first search (BFS)', needsStart: true },
  { value: 'dfs', label: 'Depth-first search (DFS)', needsStart: true },
  { value: 'dijkstra', label: "Dijkstra's shortest paths", needsStart: true },
  { value: 'prim', label: "Prim's minimum spanning tree", needsStart: true },
  { value: 'kruskal', label: "Kruskal's minimum spanning tree", needsStart: false },
  { value: 'topo', label: "Topological sort (Kahn's)", needsStart: false },
];

export interface GraphState {
  /** Nodes finished / settled / in the tree. */
  done: readonly string[];
  /** Nodes discovered but not finished (queue, stack or priority queue). */
  frontier: readonly string[];
  current: string | null;
  /** Edge being looked at, as an index into graph.edges. */
  edge: number | null;
  /** Edges in the BFS/DFS tree, shortest-path tree or spanning tree. */
  tree: readonly number[];
  /** Edges rejected (Kruskal cycle) or not improving (Dijkstra). */
  rejected: readonly number[];
  dist: Readonly<Record<string, number | null>>;
  prev: Readonly<Record<string, string | null>>;
  /** Visit order (BFS/DFS) or topological order. */
  order: readonly string[];
  /** How the frontier is printed: "Queue", "Stack", "Priority queue", "Edges by weight"… */
  frontierLabel: string;
}

/**
 * One edge per line: "A B" or "A B 4" (weight). A line with a single name adds an isolated node.
 * Returns an error message instead of throwing.
 */
export function parseGraph(text: string, directed: boolean): Graph | string {
  const nodes: string[] = [];
  const edges: Edge[] = [];
  const add = (n: string) => {
    if (!nodes.includes(n)) nodes.push(n);
  };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).replace(/#.*/, '').trim();
    if (!line) continue;
    const parts = line.split(/[\s,]+|->|--/).filter(Boolean);
    const bad = parts.find((p, k) => k < 2 && !/^[A-Za-z0-9_]{1,8}$/.test(p));
    if (bad)
      return `Line ${i + 1}: "${bad}" is not a valid node name (letters and digits, up to 8).`;
    if (parts.length === 1) {
      add(parts[0] as string);
      continue;
    }
    if (parts.length > 3) return `Line ${i + 1}: expected "from to [weight]".`;
    const [from, to, w] = parts as [string, string, string | undefined];
    if (w !== undefined && !/^-?\d{1,6}(\.\d+)?$/.test(w)) {
      return `Line ${i + 1}: the weight "${w}" is not a number.`;
    }
    add(from);
    add(to);
    edges.push({ from, to, weight: w === undefined ? 1 : Number(w) });
  }
  if (nodes.length === 0) return 'Add at least one edge, for example "A B 4".';
  if (nodes.length > 26) return 'At most 26 nodes.';
  if (edges.length > 80) return 'At most 80 edges.';
  return { nodes, edges, directed };
}

interface Adj {
  to: string;
  weight: number;
  edge: number;
}

function adjacency(g: Graph): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>(g.nodes.map((n) => [n, []]));
  g.edges.forEach((e, i) => {
    adj.get(e.from)?.push({ to: e.to, weight: e.weight, edge: i });
    if (!g.directed) adj.get(e.to)?.push({ to: e.from, weight: e.weight, edge: i });
  });
  // Neighbours in alphabetical order, the convention textbooks use for BFS/DFS by hand.
  for (const list of adj.values())
    list.sort((a, b) => a.to.localeCompare(b.to, 'en', { numeric: true }));
  return adj;
}

class GraphRecorder {
  steps: Step<GraphState>[] = [];
  done: string[] = [];
  frontier: string[] = [];
  tree: number[] = [];
  rejected: number[] = [];
  order: string[] = [];
  dist: Record<string, number | null> = {};
  prev: Record<string, string | null> = {};

  constructor(
    readonly g: Graph,
    readonly frontierLabel: string,
  ) {
    for (const n of g.nodes) {
      this.dist[n] = null;
      this.prev[n] = null;
    }
  }

  snap(label: string, current: string | null = null, edge: number | null = null) {
    this.steps.push({
      label,
      state: {
        done: [...this.done],
        frontier: [...this.frontier],
        current,
        edge,
        tree: [...this.tree],
        rejected: [...this.rejected],
        dist: { ...this.dist },
        prev: { ...this.prev },
        order: [...this.order],
        frontierLabel: this.frontierLabel,
      },
    });
  }
}

function bfs(g: Graph, start: string): GraphRecorder {
  const r = new GraphRecorder(g, 'Queue');
  const adj = adjacency(g);
  const seen = new Set([start]);
  r.frontier = [start];
  r.dist[start] = 0;
  r.snap(`Enqueue the start node ${start} (distance 0).`, start);
  while (r.frontier.length) {
    const u = r.frontier.shift() as string;
    r.order.push(u);
    r.snap(`Dequeue ${u} and visit it.`, u);
    for (const { to, edge } of adj.get(u) ?? []) {
      if (seen.has(to)) {
        r.snap(`${to} was already discovered, skip it.`, u, edge);
        continue;
      }
      seen.add(to);
      r.dist[to] = (r.dist[u] as number) + 1;
      r.prev[to] = u;
      r.tree.push(edge);
      r.frontier.push(to);
      r.snap(`Discover ${to} from ${u} (distance ${r.dist[to]}), enqueue it.`, u, edge);
    }
    r.done.push(u);
  }
  r.snap(`BFS order: ${r.order.join(', ')}.${unreached(g, r)}`);
  return r;
}

function unreached(g: Graph, r: GraphRecorder): string {
  const missing = g.nodes.filter((n) => !r.order.includes(n) && !r.done.includes(n));
  return missing.length ? ` Not reachable from the start: ${missing.join(', ')}.` : '';
}

function dfs(g: Graph, start: string): GraphRecorder {
  const r = new GraphRecorder(g, 'Recursion stack');
  const adj = adjacency(g);
  const seen = new Set<string>();
  let time = 0;
  const visit = (u: string, via: number | null) => {
    seen.add(u);
    r.frontier.push(u);
    r.order.push(u);
    r.dist[u] = ++time;
    r.snap(via === null ? `Start DFS at ${u}.` : `Go deeper to ${u}.`, u, via);
    for (const { to, edge } of adj.get(u) ?? []) {
      if (seen.has(to)) {
        r.snap(`${to} already visited, skip.`, u, edge);
        continue;
      }
      r.prev[to] = u;
      r.tree.push(edge);
      visit(to, edge);
      r.snap(`Back at ${u}.`, u);
    }
    r.frontier.pop();
    r.done.push(u);
    r.snap(`${u} is finished: all its neighbours are explored.`, u);
  };
  visit(start, null);
  r.snap(`DFS order: ${r.order.join(', ')}.${unreached(g, r)}`);
  return r;
}

function dijkstra(g: Graph, start: string): GraphRecorder | string {
  if (g.edges.some((e) => e.weight < 0)) {
    return "Dijkstra's algorithm needs non-negative weights. Remove the negative edge.";
  }
  const r = new GraphRecorder(g, 'Priority queue (by distance)');
  const adj = adjacency(g);
  r.dist[start] = 0;
  r.frontier = [start];
  r.snap(`dist(${start}) = 0, every other node starts at ∞.`, start);
  const settled = new Set<string>();
  const bestEdge: Record<string, number> = {};
  while (r.frontier.length) {
    r.frontier.sort(
      (a, b) =>
        (r.dist[a] as number) - (r.dist[b] as number) ||
        a.localeCompare(b, 'en', { numeric: true }),
    );
    const u = r.frontier.shift() as string;
    settled.add(u);
    r.done.push(u);
    r.order.push(u);
    r.snap(`Take ${u}, the closest unsettled node (dist ${fmt(r.dist[u])}). It is now final.`, u);
    for (const { to, weight, edge } of adj.get(u) ?? []) {
      if (settled.has(to)) continue;
      const alt = (r.dist[u] as number) + weight;
      const old = r.dist[to] ?? null;
      if (old === null || alt < old) {
        r.dist[to] = alt;
        // Only the best edge into each node stays in the shortest-path tree.
        bestEdge[to] = edge;
        r.tree = Object.values(bestEdge);
        r.prev[to] = u;
        if (!r.frontier.includes(to)) r.frontier.push(to);
        r.snap(
          `Relax ${u}→${to}: ${fmt(r.dist[u])} + ${weight} = ${alt} < ${fmt(old)}, update dist(${to}).`,
          u,
          edge,
        );
      } else {
        r.rejected.push(edge);
        r.snap(
          `Relax ${u}→${to}: ${fmt(r.dist[u])} + ${weight} = ${alt} ≥ ${fmt(old)}, no change.`,
          u,
          edge,
        );
        r.rejected.pop();
      }
    }
  }
  r.snap(`Shortest distances from ${start} are final.${unreached(g, r)}`);
  return r;
}

const fmt = (d: number | null | undefined) => (d === null || d === undefined ? '∞' : String(d));

function prim(g: Graph, start: string): GraphRecorder | string {
  if (g.directed)
    return 'Minimum spanning trees are defined for undirected graphs. Untick "Directed".';
  const r = new GraphRecorder(g, 'Candidate edges');
  const adj = adjacency(g);
  const inTree = new Set([start]);
  r.done.push(start);
  r.dist[start] = 0;
  r.snap(`Start the tree at ${start}.`, start);
  let total = 0;
  while (inTree.size < g.nodes.length) {
    let best: (Adj & { from: string }) | null = null;
    for (const u of inTree) {
      for (const a of adj.get(u) ?? []) {
        if (inTree.has(a.to)) continue;
        if (!best || a.weight < best.weight || (a.weight === best.weight && a.edge < best.edge))
          best = { ...a, from: u };
      }
    }
    r.frontier = g.nodes.filter(
      (n) => !inTree.has(n) && (adj.get(n) ?? []).some((a) => inTree.has(a.to)),
    );
    if (!best) {
      r.snap(
        `The graph is disconnected: ${g.nodes.filter((n) => !inTree.has(n)).join(', ')} cannot be reached.`,
      );
      break;
    }
    inTree.add(best.to);
    r.done.push(best.to);
    r.tree.push(best.edge);
    r.prev[best.to] = best.from;
    r.dist[best.to] = best.weight;
    total += best.weight;
    r.frontier = r.frontier.filter((n) => n !== best.to);
    r.snap(
      `Cheapest edge leaving the tree: ${best.from}–${best.to} (${best.weight}). Add it.`,
      best.to,
      best.edge,
    );
  }
  r.frontier = [];
  r.snap(`Minimum spanning tree weight: ${total}.`);
  return r;
}

function kruskal(g: Graph): GraphRecorder | string {
  if (g.directed)
    return 'Minimum spanning trees are defined for undirected graphs. Untick "Directed".';
  const r = new GraphRecorder(g, 'Components');
  const parent = new Map(g.nodes.map((n) => [n, n]));
  const find = (x: string): string => {
    const p = parent.get(x) as string;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const components = () => {
    const groups = new Map<string, string[]>();
    for (const n of g.nodes) groups.set(find(n), [...(groups.get(find(n)) ?? []), n]);
    return [...groups.values()].map((c) => `{${c.join(',')}}`);
  };
  const order = g.edges
    .map((_, i) => i)
    .sort((a, b) => (g.edges[a] as Edge).weight - (g.edges[b] as Edge).weight || a - b);
  r.frontier = components();
  r.snap(
    `Sort the edges by weight: ${order.map((i) => `${g.edges[i]?.from}${g.edges[i]?.to}(${g.edges[i]?.weight})`).join(', ')}.`,
  );
  let total = 0;
  for (const i of order) {
    const e = g.edges[i] as Edge;
    const a = find(e.from);
    const b = find(e.to);
    if (a === b) {
      r.rejected.push(i);
      r.snap(
        `${e.from}–${e.to} (${e.weight}) would close a cycle: ${e.from} and ${e.to} are already connected. Skip.`,
        null,
        i,
      );
      continue;
    }
    parent.set(a, b);
    r.tree.push(i);
    total += e.weight;
    for (const n of [e.from, e.to]) if (!r.done.includes(n)) r.done.push(n);
    r.frontier = components();
    r.snap(`Add ${e.from}–${e.to} (${e.weight}): it joins two components.`, null, i);
    if (r.tree.length === g.nodes.length - 1) break;
  }
  r.snap(
    r.tree.length === g.nodes.length - 1
      ? `Minimum spanning tree weight: ${total} (${r.tree.length} edges = nodes − 1).`
      : `The graph is disconnected: this is a minimum spanning forest of weight ${total}.`,
  );
  return r;
}

function topo(g: Graph): GraphRecorder | string {
  if (!g.directed) return 'Topological order needs a directed graph. Tick "Directed".';
  const r = new GraphRecorder(g, 'Queue (in-degree 0)');
  const adj = adjacency(g);
  const indeg: Record<string, number> = Object.fromEntries(g.nodes.map((n) => [n, 0]));
  for (const e of g.edges) indeg[e.to] = (indeg[e.to] ?? 0) + 1;
  for (const n of g.nodes) r.dist[n] = indeg[n] ?? 0;
  r.frontier = g.nodes
    .filter((n) => indeg[n] === 0)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  r.snap(
    `In-degrees computed (shown as d). Nodes with in-degree 0: ${r.frontier.join(', ') || 'none'}.`,
  );
  while (r.frontier.length) {
    const u = r.frontier.shift() as string;
    r.order.push(u);
    r.done.push(u);
    r.snap(`Output ${u}.`, u);
    for (const { to, edge } of adj.get(u) ?? []) {
      indeg[to] = (indeg[to] as number) - 1;
      r.dist[to] = indeg[to] as number;
      r.tree.push(edge);
      if (indeg[to] === 0) {
        r.frontier.push(to);
        r.frontier.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      }
      r.snap(
        `Remove ${u}→${to}: in-degree of ${to} is now ${indeg[to]}${indeg[to] === 0 ? ', enqueue it' : ''}.`,
        u,
        edge,
      );
    }
  }
  r.snap(
    r.order.length === g.nodes.length
      ? `Topological order: ${r.order.join(', ')}.`
      : `Cycle detected: ${g.nodes.filter((n) => !r.order.includes(n)).join(', ')} never reach in-degree 0, so no topological order exists.`,
  );
  return r;
}

export function graphSteps(
  g: Graph,
  algorithm: GraphAlgorithm,
  start: string,
): Step<GraphState>[] | string {
  const s = g.nodes.includes(start) ? start : (g.nodes[0] as string);
  const result =
    algorithm === 'bfs'
      ? bfs(g, s)
      : algorithm === 'dfs'
        ? dfs(g, s)
        : algorithm === 'dijkstra'
          ? dijkstra(g, s)
          : algorithm === 'prim'
            ? prim(g, s)
            : algorithm === 'kruskal'
              ? kruskal(g)
              : topo(g);
  return typeof result === 'string' ? result : result.steps;
}

/** Node positions on a circle (or a line for 2 nodes), in a 0..1 box. */
export function circleLayout(nodes: readonly string[]): Record<string, { x: number; y: number }> {
  const n = nodes.length;
  const out: Record<string, { x: number; y: number }> = {};
  nodes.forEach((name, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    out[name] =
      n === 1
        ? { x: 0.5, y: 0.5 }
        : { x: 0.5 + 0.42 * Math.cos(angle), y: 0.5 + 0.42 * Math.sin(angle) };
  });
  return out;
}
