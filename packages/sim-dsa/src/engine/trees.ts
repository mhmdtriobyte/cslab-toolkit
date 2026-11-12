import type { Step } from '@oslab/core/engine';

export interface TreeNode {
  /** Stable id, so the drawing can animate a node that moves. */
  id: number;
  key: number;
  left: TreeNode | null;
  right: TreeNode | null;
  height: number;
}

export interface TreeState {
  root: TreeNode | null;
  /** Nodes on the path being walked. */
  path: readonly number[];
  /** The node this step is about. */
  focus: number | null;
  /** Nodes that just took part in a rotation, or were swapped. */
  changed: readonly number[];
  /** Output of a traversal so far. */
  visited: readonly number[];
}

export type TreeKind = 'bst' | 'avl';

export type TreeOp =
  | { op: 'insert'; key: number }
  | { op: 'delete'; key: number }
  | { op: 'search'; key: number }
  | { op: 'inorder' | 'preorder' | 'postorder' | 'levelorder' };

export const TRAVERSALS = ['inorder', 'preorder', 'postorder', 'levelorder'] as const;

/**
 * "insert 50 30 70; delete 30; search 60; inorder" → ops. Commands may be abbreviated to their
 * first letter (i, d, s). Returns an error message instead of throwing.
 */
export function parseTreeOps(text: string): TreeOp[] | string {
  const ops: TreeOp[] = [];
  for (const raw of text.split(/[;\n]+/)) {
    const words = raw
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (words.length === 0) continue;
    const [cmd, ...args] = words as [string, ...string[]];
    if ((TRAVERSALS as readonly string[]).includes(cmd)) {
      ops.push({ op: cmd as (typeof TRAVERSALS)[number] });
      continue;
    }
    const op =
      cmd === 'i' || cmd === 'insert' || cmd === 'add'
        ? 'insert'
        : cmd === 'd' || cmd === 'delete' || cmd === 'remove'
          ? 'delete'
          : cmd === 's' || cmd === 'search' || cmd === 'find'
            ? 'search'
            : null;
    if (!op) return `Unknown command "${cmd}". Use insert, delete, search or a traversal.`;
    if (args.length === 0) return `"${cmd}" needs at least one number.`;
    for (const a of args) {
      if (!/^-?\d{1,4}$/.test(a)) return `"${a}" is not a whole number (up to 4 digits).`;
      ops.push({ op, key: Number(a) });
    }
  }
  if (ops.length > 200) return 'Too many operations (200 at most).';
  return ops;
}

const h = (n: TreeNode | null) => n?.height ?? 0;
const fix = (n: TreeNode) => {
  n.height = 1 + Math.max(h(n.left), h(n.right));
};
const balance = (n: TreeNode | null) => (n ? h(n.left) - h(n.right) : 0);

function clone(n: TreeNode | null): TreeNode | null {
  return n ? { ...n, left: clone(n.left), right: clone(n.right) } : null;
}

export function treeSize(n: TreeNode | null): number {
  return n ? 1 + treeSize(n.left) + treeSize(n.right) : 0;
}

export function treeHeight(n: TreeNode | null): number {
  return h(n);
}

export function inorderKeys(n: TreeNode | null): number[] {
  return n ? [...inorderKeys(n.left), n.key, ...inorderKeys(n.right)] : [];
}

class TreeRecorder {
  root: TreeNode | null = null;
  steps: Step<TreeState>[] = [];
  nextId = 1;

  constructor(readonly kind: TreeKind) {}

  snap(label: string, s: Partial<Omit<TreeState, 'root'>> = {}) {
    this.steps.push({
      label,
      state: {
        root: clone(this.root),
        path: s.path ?? [],
        focus: s.focus ?? null,
        changed: s.changed ?? [],
        visited: s.visited ?? [],
      },
    });
  }

  rotateRight(y: TreeNode): TreeNode {
    const x = y.left as TreeNode;
    y.left = x.right;
    x.right = y;
    fix(y);
    fix(x);
    return x;
  }

  rotateLeft(x: TreeNode): TreeNode {
    const y = x.right as TreeNode;
    x.right = y.left;
    y.left = x;
    fix(x);
    fix(y);
    return y;
  }

  /** Re-balances `n` if it is an AVL node with |balance| > 1; replaces it in the tree via `set`. */
  rebalance(n: TreeNode, set: (m: TreeNode) => void): TreeNode {
    fix(n);
    if (this.kind !== 'avl') return n;
    const b = balance(n);
    if (b > 1) {
      const left = n.left as TreeNode;
      if (balance(left) < 0) {
        this.snap(`Node ${n.key} has balance +${b}, and its left child leans right: LR case.`, {
          focus: n.id,
          changed: [n.id, left.id],
        });
        n.left = this.rotateLeft(left);
        set(n);
        this.snap(`Rotate left at ${left.key}.`, { changed: [left.id, n.left.id] });
      } else {
        this.snap(`Node ${n.key} has balance +${b}: LL case.`, {
          focus: n.id,
          changed: [n.id],
        });
      }
      const top = this.rotateRight(n);
      set(top);
      this.snap(`Rotate right at ${n.key}: ${top.key} moves up.`, { changed: [n.id, top.id] });
      return top;
    }
    if (b < -1) {
      const right = n.right as TreeNode;
      if (balance(right) > 0) {
        this.snap(`Node ${n.key} has balance ${b}, and its right child leans left: RL case.`, {
          focus: n.id,
          changed: [n.id, right.id],
        });
        n.right = this.rotateRight(right);
        set(n);
        this.snap(`Rotate right at ${right.key}.`, { changed: [right.id, n.right.id] });
      } else {
        this.snap(`Node ${n.key} has balance ${b}: RR case.`, { focus: n.id, changed: [n.id] });
      }
      const top = this.rotateLeft(n);
      set(top);
      this.snap(`Rotate left at ${n.key}: ${top.key} moves up.`, { changed: [n.id, top.id] });
      return top;
    }
    return n;
  }

  /** Path from the root to `key` (or to where it would be). */
  walk(key: number): { path: TreeNode[]; found: TreeNode | null } {
    const path: TreeNode[] = [];
    let cur = this.root;
    while (cur) {
      path.push(cur);
      if (key === cur.key) return { path, found: cur };
      cur = key < cur.key ? cur.left : cur.right;
    }
    return { path, found: null };
  }

  /** Parent setter for `child`, found by walking from the root. */
  setter(path: TreeNode[], index: number): (m: TreeNode | null) => void {
    if (index === 0) return (m) => (this.root = m);
    const parent = path[index - 1] as TreeNode;
    const child = path[index] as TreeNode;
    return parent.left === child ? (m) => (parent.left = m) : (m) => (parent.right = m);
  }

  retrace(path: TreeNode[]) {
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i] as TreeNode;
      const set = this.setter(path, i);
      this.rebalance(node, (m) => set(m));
    }
  }

  insert(key: number) {
    const { path, found } = this.walk(key);
    const ids = path.map((n) => n.id);
    if (found) {
      this.snap(`${key} is already in the tree: duplicates are ignored.`, {
        path: ids,
        focus: found.id,
      });
      return;
    }
    const node: TreeNode = { id: this.nextId++, key, left: null, right: null, height: 1 };
    const parent = path[path.length - 1];
    if (!parent) {
      this.root = node;
      this.snap(`Insert ${key} as the root.`, { focus: node.id });
      return;
    }
    const dirs = path.map((n) =>
      key < n.key ? `${key} < ${n.key}, go left` : `${key} > ${n.key}, go right`,
    );
    if (key < parent.key) parent.left = node;
    else parent.right = node;
    this.snap(`Insert ${key}: ${dirs.join('; ')}.`, { path: ids, focus: node.id });
    this.retrace(path);
  }

  delete(key: number) {
    const { path, found } = this.walk(key);
    const ids = path.map((n) => n.id);
    if (!found) {
      this.snap(`${key} is not in the tree: nothing to delete.`, { path: ids });
      return;
    }
    const idx = path.length - 1;
    const set = this.setter(path, idx);
    if (!found.left || !found.right) {
      const child = found.left ?? found.right;
      this.snap(
        child
          ? `Delete ${key}: it has one child, ${child.key} takes its place.`
          : `Delete ${key}: it is a leaf, just remove it.`,
        { path: ids, focus: found.id },
      );
      set(child);
      this.snap(`${key} deleted.`, { changed: child ? [child.id] : [] });
      this.retrace(path.slice(0, idx));
      return;
    }
    // Two children: copy the in-order successor (smallest key on the right), then delete it.
    const succPath: TreeNode[] = [...path];
    let succ = found.right;
    while (succ) {
      succPath.push(succ);
      if (!succ.left) break;
      succ = succ.left;
    }
    const s = succ as TreeNode;
    this.snap(
      `Delete ${key}: it has two children. Its in-order successor is ${s.key} (leftmost in the right subtree).`,
      { path: succPath.map((n) => n.id), focus: s.id },
    );
    found.key = s.key;
    this.snap(`Copy ${s.key} into the node, then remove the old ${s.key}.`, {
      focus: found.id,
      changed: [found.id],
    });
    const sIdx = succPath.length - 1;
    this.setter(succPath, sIdx)(s.right);
    this.snap(`Old ${s.key} removed.`, { changed: s.right ? [s.right.id] : [] });
    this.retrace(succPath.slice(0, sIdx));
  }

  search(key: number) {
    const { path, found } = this.walk(key);
    const visitedIds: number[] = [];
    for (const n of path) {
      visitedIds.push(n.id);
      const verdict =
        key === n.key
          ? 'found'
          : key < n.key
            ? `${key} < ${n.key}, go left`
            : `${key} > ${n.key}, go right`;
      this.snap(`Search ${key}: at ${n.key}, ${verdict}.`, { path: [...visitedIds], focus: n.id });
    }
    if (!found)
      this.snap(
        `Search ${key}: reached an empty spot, so ${key} is not in the tree (${path.length} comparisons).`,
        {
          path: visitedIds,
        },
      );
  }

  traverse(order: (typeof TRAVERSALS)[number]) {
    const out: number[] = [];
    const names = {
      inorder: 'In-order (left, node, right)',
      preorder: 'Pre-order (node, left, right)',
      postorder: 'Post-order (left, right, node)',
      levelorder: 'Level-order (breadth first)',
    };
    this.snap(`${names[order]} traversal.`);
    const visit = (n: TreeNode) => {
      out.push(n.key);
      this.snap(`Visit ${n.key}.`, { focus: n.id, visited: [...out] });
    };
    const rec = (n: TreeNode | null) => {
      if (!n) return;
      if (order === 'preorder') visit(n);
      rec(n.left);
      if (order === 'inorder') visit(n);
      rec(n.right);
      if (order === 'postorder') visit(n);
    };
    if (order === 'levelorder') {
      const queue = this.root ? [this.root] : [];
      while (queue.length) {
        const n = queue.shift() as TreeNode;
        visit(n);
        if (n.left) queue.push(n.left);
        if (n.right) queue.push(n.right);
      }
    } else rec(this.root);
    this.snap(`${names[order]}: ${out.join(', ') || '(empty tree)'}.`, { visited: out });
  }
}

export function treeSteps(ops: readonly TreeOp[], kind: TreeKind): Step<TreeState>[] {
  const r = new TreeRecorder(kind);
  r.snap(kind === 'avl' ? 'Empty AVL tree.' : 'Empty binary search tree.');
  for (const o of ops) {
    if (o.op === 'insert') r.insert(o.key);
    else if (o.op === 'delete') r.delete(o.key);
    else if (o.op === 'search') r.search(o.key);
    else r.traverse(o.op);
  }
  return r.steps;
}

// ---- Binary heap ----

export type HeapKind = 'min' | 'max';

export type HeapOp = { op: 'insert'; key: number } | { op: 'extract' };

export interface HeapState {
  heap: readonly number[];
  /** Indices compared or swapped. */
  active: readonly number[];
  swapped: boolean;
  extracted: readonly number[];
}

export function parseHeapOps(text: string): HeapOp[] | string {
  const ops: HeapOp[] = [];
  for (const raw of text.split(/[;\n]+/)) {
    const words = raw
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (words.length === 0) continue;
    const [cmd, ...args] = words as [string, ...string[]];
    if (['extract', 'x', 'pop', 'extract-min', 'extract-max', 'delete'].includes(cmd)) {
      const times = args[0] && /^\d{1,2}$/.test(args[0]) ? Number(args[0]) : 1;
      for (let k = 0; k < times; k++) ops.push({ op: 'extract' });
      continue;
    }
    if (!['insert', 'i', 'push', 'add'].includes(cmd)) {
      return `Unknown command "${cmd}". Use insert or extract.`;
    }
    for (const a of args) {
      if (!/^-?\d{1,4}$/.test(a)) return `"${a}" is not a whole number (up to 4 digits).`;
      ops.push({ op: 'insert', key: Number(a) });
    }
  }
  if (ops.length > 200) return 'Too many operations (200 at most).';
  return ops;
}

export function heapSteps(ops: readonly HeapOp[], kind: HeapKind): Step<HeapState>[] {
  const a: number[] = [];
  const extracted: number[] = [];
  const steps: Step<HeapState>[] = [];
  const better = (x: number, y: number) => (kind === 'min' ? x < y : x > y);
  const word = kind === 'min' ? 'smaller' : 'larger';
  const snap = (label: string, active: number[] = [], swapped = false) =>
    steps.push({ label, state: { heap: [...a], active, swapped, extracted: [...extracted] } });
  const swap = (i: number, j: number) => {
    const t = a[i] as number;
    a[i] = a[j] as number;
    a[j] = t;
  };
  snap(`Empty ${kind}-heap. Children of index i are 2i+1 and 2i+2; its parent is ⌊(i−1)/2⌋.`);
  for (const o of ops) {
    if (o.op === 'insert') {
      a.push(o.key);
      let i = a.length - 1;
      snap(`Insert ${o.key} at the end (index ${i}), then sift it up.`, [i]);
      while (i > 0) {
        const p = Math.floor((i - 1) / 2);
        if (better(a[i] as number, a[p] as number)) {
          swap(i, p);
          snap(`${a[p]} is ${word} than its parent ${a[i]}: swap.`, [p, i], true);
          i = p;
        } else {
          snap(`${a[i]} is not ${word} than its parent ${a[p]}: stop.`, [i, p]);
          break;
        }
      }
    } else {
      if (a.length === 0) {
        snap('The heap is empty: nothing to extract.');
        continue;
      }
      const top = a[0] as number;
      const last = a.pop() as number;
      extracted.push(top);
      if (a.length === 0) {
        snap(`Extract ${top}: it was the only element.`);
        continue;
      }
      a[0] = last;
      snap(`Extract ${top}; move the last element ${last} to the root, then sift it down.`, [0]);
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let pick = i;
        if (l < a.length && better(a[l] as number, a[pick] as number)) pick = l;
        if (r < a.length && better(a[r] as number, a[pick] as number)) pick = r;
        if (pick === i) {
          snap(
            l < a.length ? `${a[i]} is in place: no child is ${word}.` : `${a[i]} is a leaf now.`,
            [i],
          );
          break;
        }
        swap(i, pick);
        snap(`Swap ${a[pick]} with its ${word} child ${a[i]}.`, [i, pick], true);
        i = pick;
      }
    }
  }
  return steps;
}

// ---- Hash table ----

export type HashMethod = 'chaining' | 'linear' | 'quadratic' | 'double';

export const HASH_METHODS: { value: HashMethod; label: string }[] = [
  { value: 'chaining', label: 'Separate chaining' },
  { value: 'linear', label: 'Linear probing' },
  { value: 'quadratic', label: 'Quadratic probing' },
  { value: 'double', label: 'Double hashing' },
];

export type HashOp = { op: 'insert' | 'search' | 'delete'; key: number };

export interface HashState {
  /** Open addressing: one key, null (empty) or "deleted" (tombstone). Chaining: a list per slot. */
  slots: readonly (number | null | 'deleted' | readonly number[])[];
  probe: readonly number[];
  current: number | null;
  found: boolean | null;
  count: number;
}

export function parseHashOps(text: string): HashOp[] | string {
  const ops: HashOp[] = [];
  for (const raw of text.split(/[;\n]+/)) {
    const words = raw
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (words.length === 0) continue;
    const [cmd, ...args] = words as [string, ...string[]];
    const op =
      cmd === 'i' || cmd === 'insert' || cmd === 'add'
        ? 'insert'
        : cmd === 's' || cmd === 'search' || cmd === 'find'
          ? 'search'
          : cmd === 'd' || cmd === 'delete' || cmd === 'remove'
            ? 'delete'
            : null;
    if (!op) return `Unknown command "${cmd}". Use insert, search or delete.`;
    for (const a of args) {
      if (!/^\d{1,6}$/.test(a)) return `"${a}" is not a non-negative whole number.`;
      ops.push({ op, key: Number(a) });
    }
  }
  if (ops.length > 200) return 'Too many operations (200 at most).';
  return ops;
}

/** Second hash for double hashing: R − (k mod R), with R the largest prime below m. */
export function secondHash(key: number, m: number): number {
  let r = m - 1;
  const prime = (n: number) => {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  };
  while (r > 1 && !prime(r)) r--;
  return r < 2 ? 1 : r - (key % r);
}

export function hashSteps(
  ops: readonly HashOp[],
  m: number,
  method: HashMethod,
): Step<HashState>[] {
  const steps: Step<HashState>[] = [];
  const open: (number | null | 'deleted')[] = Array.from({ length: m }, () => null);
  const chains: number[][] = Array.from({ length: m }, () => []);
  let count = 0;
  const snap = (
    label: string,
    probe: number[] = [],
    current: number | null = null,
    found: boolean | null = null,
  ) =>
    steps.push({
      label,
      state: {
        slots: method === 'chaining' ? chains.map((c) => [...c]) : [...open],
        probe,
        current,
        found,
        count,
      },
    });
  const fn =
    method === 'double'
      ? `h(k) = k mod ${m}, step = h₂(k) = R − (k mod R)`
      : method === 'quadratic'
        ? `h(k, i) = (k mod ${m} + i²) mod ${m}`
        : method === 'linear'
          ? `h(k, i) = (k mod ${m} + i) mod ${m}`
          : `h(k) = k mod ${m}`;
  snap(`Empty table with ${m} slots. ${fn}.`);
  const slotAt = (key: number, i: number) => {
    const base = key % m;
    if (method === 'linear') return (base + i) % m;
    if (method === 'quadratic') return (base + i * i) % m;
    return (base + i * secondHash(key, m)) % m;
  };
  for (const { op, key } of ops) {
    const home = key % m;
    if (method === 'chaining') {
      const chain = chains[home] as number[];
      const at = chain.indexOf(key);
      if (op === 'insert') {
        if (at >= 0) snap(`${key} is already in slot ${home}.`, [home], home, true);
        else {
          chain.push(key);
          count++;
          snap(
            `Insert ${key}: ${key} mod ${m} = ${home}${chain.length > 1 ? `, collision: append to the chain (length ${chain.length})` : ''}.`,
            [home],
            home,
          );
        }
      } else if (op === 'search') {
        snap(
          at >= 0
            ? `Search ${key}: slot ${home}, found after ${at + 1} comparison(s) in the chain.`
            : `Search ${key}: slot ${home}, not in its chain (${chain.length} comparison(s)).`,
          [home],
          home,
          at >= 0,
        );
      } else if (at >= 0) {
        chain.splice(at, 1);
        count--;
        snap(`Delete ${key} from the chain in slot ${home}.`, [home], home, true);
      } else snap(`Delete ${key}: not in slot ${home}'s chain.`, [home], home, false);
      continue;
    }
    // Open addressing.
    const probe: number[] = [];
    let done = false;
    let firstTomb: number | null = null;
    for (let i = 0; i < m && !done; i++) {
      const s = slotAt(key, i);
      probe.push(s);
      const v = open[s];
      const via = i === 0 ? `${key} mod ${m} = ${s}` : `probe ${i}: slot ${s}`;
      if (v === key) {
        if (op === 'insert') snap(`${via}: ${key} is already in the table.`, [...probe], s, true);
        else if (op === 'search')
          snap(`${via}: found ${key} after ${i + 1} probe(s).`, [...probe], s, true);
        else {
          open[s] = 'deleted';
          count--;
          snap(
            `${via}: delete ${key}, leaving a tombstone so later searches keep probing past it.`,
            [...probe],
            s,
            true,
          );
        }
        done = true;
      } else if (v === null) {
        if (op === 'insert') {
          const target = firstTomb ?? s;
          open[target] = key;
          count++;
          snap(
            `${via}: empty${target !== s ? `, so reuse the tombstone at slot ${target}` : ''}. Insert ${key}${i > 0 ? ` after ${i} collision(s)` : ''}.`,
            [...probe],
            target,
          );
        } else
          snap(
            `${via}: empty slot, so ${key} is not in the table (${i + 1} probe(s)).`,
            [...probe],
            s,
            false,
          );
        done = true;
      } else if (v === 'deleted') {
        if (op === 'insert' && firstTomb === null) firstTomb = s;
        snap(`${via}: tombstone, keep probing.`, [...probe], s);
      } else {
        snap(`${via}: occupied by ${v}, collision.`, [...probe], s);
      }
    }
    if (!done) {
      if (op === 'insert' && firstTomb !== null) {
        open[firstTomb] = key;
        count++;
        snap(`Insert ${key} into the tombstone at slot ${firstTomb}.`, probe, firstTomb);
      } else
        snap(
          op === 'insert'
            ? `No free slot found after ${m} probes: ${key} cannot be inserted${method === 'quadratic' ? ' (quadratic probing may miss free slots when the table is over half full)' : ''}.`
            : `${key} is not in the table (${m} probes).`,
          probe,
          null,
          false,
        );
    }
  }
  return steps;
}
