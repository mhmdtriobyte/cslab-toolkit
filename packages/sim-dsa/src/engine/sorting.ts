import type { Step } from '@oslab/core/engine';

export type SortAlgorithm = 'bubble' | 'selection' | 'insertion' | 'merge' | 'quick' | 'heap';

export const SORT_ALGORITHMS: { value: SortAlgorithm; label: string; complexity: string }[] = [
  { value: 'bubble', label: 'Bubble sort', complexity: 'O(n²), stable' },
  { value: 'selection', label: 'Selection sort', complexity: 'O(n²), not stable' },
  { value: 'insertion', label: 'Insertion sort', complexity: 'O(n²), O(n) if sorted, stable' },
  { value: 'merge', label: 'Merge sort', complexity: 'O(n log n), stable, O(n) extra' },
  { value: 'quick', label: 'Quick sort (Lomuto)', complexity: 'O(n log n) avg, O(n²) worst' },
  { value: 'heap', label: 'Heap sort', complexity: 'O(n log n), not stable' },
];

export interface SortState {
  array: readonly number[];
  /** Indices being compared in this step. */
  compare: readonly number[];
  /** Indices just swapped or written. */
  moved: readonly number[];
  /** Indices already in their final position. */
  sorted: readonly number[];
  pivot: number | null;
  /** Active sub-array [lo, hi] (merge / quick / heap). */
  range: readonly [number, number] | null;
  comparisons: number;
  /** Swaps, or element writes for merge and insertion sort. */
  moves: number;
}

export interface SortResult {
  steps: Step<SortState>[];
  comparisons: number;
  moves: number;
}

class Recorder {
  a: number[];
  steps: Step<SortState>[] = [];
  comparisons = 0;
  moves = 0;
  sorted = new Set<number>();
  range: [number, number] | null = null;
  pivot: number | null = null;

  constructor(values: readonly number[]) {
    this.a = [...values];
    this.snap('Start.', [], []);
  }

  snap(label: string, compare: number[], moved: number[]) {
    this.steps.push({
      label,
      state: {
        array: [...this.a],
        compare,
        moved,
        sorted: [...this.sorted].sort((x, y) => x - y),
        pivot: this.pivot,
        range: this.range,
        comparisons: this.comparisons,
        moves: this.moves,
      },
    });
  }

  /** a[i] > a[j]? */
  greater(i: number, j: number, note = ''): boolean {
    this.comparisons++;
    const x = this.a[i] as number;
    const y = this.a[j] as number;
    const r = x > y;
    this.snap(`Compare ${x} and ${y}: ${r ? `${x} > ${y}` : `${x} ≤ ${y}`}${note}.`, [i, j], []);
    return r;
  }

  swap(i: number, j: number, why = '') {
    const x = this.a[i] as number;
    const y = this.a[j] as number;
    this.a[i] = y;
    this.a[j] = x;
    if (i !== j) this.moves++;
    this.snap(i === j ? `${x} stays in place${why}.` : `Swap ${x} and ${y}${why}.`, [], [i, j]);
  }

  write(i: number, v: number, why: string) {
    this.a[i] = v;
    this.moves++;
    this.snap(why, [], [i]);
  }

  done(i: number) {
    this.sorted.add(i);
  }
}

function bubble(r: Recorder) {
  const n = r.a.length;
  for (let pass = 0; pass < n - 1; pass++) {
    let swapped = false;
    for (let j = 0; j < n - 1 - pass; j++) {
      if (r.greater(j, j + 1)) {
        r.swap(j, j + 1);
        swapped = true;
      }
    }
    r.done(n - 1 - pass);
    if (!swapped) {
      for (let k = 0; k < n; k++) r.done(k);
      r.snap(`Pass ${pass + 1} made no swaps, so the array is sorted (early exit).`, [], []);
      return;
    }
    r.snap(`End of pass ${pass + 1}: ${r.a[n - 1 - pass]} has bubbled to its place.`, [], []);
  }
  r.done(0);
}

function selection(r: Recorder) {
  const n = r.a.length;
  for (let i = 0; i < n - 1; i++) {
    let min = i;
    for (let j = i + 1; j < n; j++) {
      if (r.greater(min, j, '')) min = j;
    }
    r.swap(i, min, ` (smallest remaining goes to index ${i})`);
    r.done(i);
  }
  r.done(n - 1);
}

function insertion(r: Recorder) {
  const n = r.a.length;
  r.done(0);
  for (let i = 1; i < n; i++) {
    let j = i;
    while (j > 0 && r.greater(j - 1, j)) {
      r.swap(j - 1, j);
      j--;
    }
    for (let k = 0; k <= i; k++) r.done(k);
    r.snap(`The first ${i + 1} elements are sorted among themselves.`, [], []);
  }
  r.sorted.clear();
  for (let k = 0; k < n; k++) r.done(k);
}

function merge(r: Recorder) {
  const sort = (lo: number, hi: number) => {
    if (lo >= hi) return;
    const mid = Math.floor((lo + hi) / 2);
    sort(lo, mid);
    sort(mid + 1, hi);
    r.range = [lo, hi];
    r.snap(`Merge [${lo}..${mid}] with [${mid + 1}..${hi}].`, [], []);
    const left = r.a.slice(lo, mid + 1);
    const right = r.a.slice(mid + 1, hi + 1);
    let i = 0;
    let j = 0;
    let k = lo;
    while (i < left.length && j < right.length) {
      r.comparisons++;
      const x = left[i] as number;
      const y = right[j] as number;
      if (x <= y) {
        r.write(k++, x, `Compare ${x} and ${y}: take ${x} from the left half.`);
        i++;
      } else {
        r.write(k++, y, `Compare ${x} and ${y}: take ${y} from the right half.`);
        j++;
      }
    }
    while (i < left.length)
      r.write(k++, left[i++] as number, 'Copy what is left of the left half.');
    while (j < right.length)
      r.write(k++, right[j++] as number, 'Copy what is left of the right half.');
  };
  sort(0, r.a.length - 1);
  r.range = null;
  for (let k = 0; k < r.a.length; k++) r.done(k);
}

function quick(r: Recorder) {
  const sort = (lo: number, hi: number) => {
    if (lo > hi) return;
    if (lo === hi) {
      r.done(lo);
      return;
    }
    r.range = [lo, hi];
    r.pivot = hi;
    r.snap(`Partition [${lo}..${hi}] around pivot ${r.a[hi]} (last element).`, [], []);
    let i = lo - 1;
    for (let j = lo; j < hi; j++) {
      if (!r.greater(j, hi, ' (pivot)')) {
        i++;
        r.swap(i, j, ' (it is ≤ pivot, move it left)');
      }
    }
    r.swap(i + 1, hi, ' (pivot goes between the two parts)');
    r.pivot = null;
    r.done(i + 1);
    sort(lo, i);
    sort(i + 2, hi);
  };
  sort(0, r.a.length - 1);
  r.range = null;
  for (let k = 0; k < r.a.length; k++) r.done(k);
}

function heap(r: Recorder) {
  const n = r.a.length;
  const siftDown = (start: number, end: number) => {
    let root = start;
    for (;;) {
      const left = 2 * root + 1;
      if (left > end) return;
      let big = left;
      if (left + 1 <= end && r.greater(left + 1, left, ' (pick the larger child)')) big = left + 1;
      if (r.greater(big, root, ' (child vs parent)')) {
        r.swap(root, big);
        root = big;
      } else return;
    }
  };
  r.range = [0, n - 1];
  r.snap('Build a max-heap: sift down every parent, from the last one to the root.', [], []);
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) siftDown(i, n - 1);
  r.snap(`Max-heap built: the largest value ${r.a[0]} is at the root.`, [], []);
  for (let end = n - 1; end > 0; end--) {
    r.swap(0, end, ' (move the maximum to the end)');
    r.done(end);
    r.range = [0, end - 1];
    siftDown(0, end - 1);
  }
  r.range = null;
  r.done(0);
}

const IMPL: Record<SortAlgorithm, (r: Recorder) => void> = {
  bubble,
  selection,
  insertion,
  merge,
  quick,
  heap,
};

export function sortSteps(values: readonly number[], algorithm: SortAlgorithm): SortResult {
  const r = new Recorder(values);
  if (values.length > 1) IMPL[algorithm](r);
  else for (let k = 0; k < values.length; k++) r.done(k);
  r.pivot = null;
  r.range = null;
  r.snap(
    `Sorted with ${r.comparisons} comparisons and ${r.moves} ${algorithm === 'merge' ? 'writes' : 'swaps'}.`,
    [],
    [],
  );
  return { steps: r.steps, comparisons: r.comparisons, moves: r.moves };
}

/** Parses "5 3, 8 1" into numbers; null if anything is not an integer or the list is too long. */
export function parseNumbers(text: string, max = 40): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > max) return null;
  if (parts.some((p) => !/^-?\d{1,6}$/.test(p))) return null;
  return parts.map(Number);
}

// ---- Searching ----

export type SearchAlgorithm = 'linear' | 'binary';

export interface SearchState {
  array: readonly number[];
  lo: number | null;
  hi: number | null;
  mid: number | null;
  /** Indices already ruled out. */
  eliminated: readonly number[];
  found: number | null;
  comparisons: number;
}

export function searchSteps(
  values: readonly number[],
  target: number,
  algorithm: SearchAlgorithm,
): { steps: Step<SearchState>[]; found: number | null; comparisons: number; sortedInput: boolean } {
  const array = [...values];
  const steps: Step<SearchState>[] = [];
  const eliminated = new Set<number>();
  let comparisons = 0;
  const snap = (
    label: string,
    s: { lo?: number | null; hi?: number | null; mid?: number | null; found?: number | null },
  ) =>
    steps.push({
      label,
      state: {
        array,
        lo: s.lo ?? null,
        hi: s.hi ?? null,
        mid: s.mid ?? null,
        eliminated: [...eliminated],
        found: s.found ?? null,
        comparisons,
      },
    });
  const sortedInput = array.every((v, i) => i === 0 || (array[i - 1] as number) <= v);

  if (algorithm === 'linear') {
    snap(`Look for ${target} from left to right.`, {});
    for (let i = 0; i < array.length; i++) {
      comparisons++;
      if (array[i] === target) {
        snap(`a[${i}] = ${target}: found after ${comparisons} comparison(s).`, {
          mid: i,
          found: i,
        });
        return { steps, found: i, comparisons, sortedInput };
      }
      eliminated.add(i);
      snap(`a[${i}] = ${array[i]} ≠ ${target}.`, { mid: i });
    }
    snap(`${target} is not in the array (${comparisons} comparisons).`, {});
    return { steps, found: null, comparisons, sortedInput };
  }

  let lo = 0;
  let hi = array.length - 1;
  snap(`Binary search for ${target} in [0..${hi}]. The array must be sorted.`, { lo, hi });
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    comparisons++;
    const v = array[mid] as number;
    if (v === target) {
      snap(`mid = ⌊(${lo}+${hi})/2⌋ = ${mid}, a[${mid}] = ${v}: found.`, {
        lo,
        hi,
        mid,
        found: mid,
      });
      return { steps, found: mid, comparisons, sortedInput };
    }
    if (v < target) {
      for (let k = lo; k <= mid; k++) eliminated.add(k);
      snap(`mid = ${mid}, a[${mid}] = ${v} < ${target}: discard the left half, lo = ${mid + 1}.`, {
        lo: mid + 1,
        hi,
        mid,
      });
      lo = mid + 1;
    } else {
      for (let k = mid; k <= hi; k++) eliminated.add(k);
      snap(`mid = ${mid}, a[${mid}] = ${v} > ${target}: discard the right half, hi = ${mid - 1}.`, {
        lo,
        hi: mid - 1,
        mid,
      });
      hi = mid - 1;
    }
  }
  snap(`lo > hi: ${target} is not in the array (${comparisons} comparisons).`, {});
  return { steps, found: null, comparisons, sortedInput };
}
