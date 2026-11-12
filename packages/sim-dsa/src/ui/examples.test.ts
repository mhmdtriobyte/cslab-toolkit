import { describe, expect, it } from 'vitest';
import { sanitizeGraph, sanitizeSort, sanitizeStruct } from './input';
import {
  graphSteps,
  hashSteps,
  heapSteps,
  parseGraph,
  parseHashOps,
  parseHeapOps,
  parseNumbers,
  parseTreeOps,
  sortSteps,
  treeSteps,
  type Graph,
  type HashOp,
  type HeapOp,
  type TreeOp,
} from '../engine';

interface Preset {
  id: string;
  input: unknown;
}

const sorting = import.meta.glob<Preset>('../../../../examples/sorting/*.json', {
  eager: true,
  import: 'default',
});
const structures = import.meta.glob<Preset>('../../../../examples/structures/*.json', {
  eager: true,
  import: 'default',
});
const graphs = import.meta.glob<Preset>('../../../../examples/graphs/*.json', {
  eager: true,
  import: 'default',
});

describe('dsa presets', () => {
  it.each(Object.entries(sorting))('%s is valid', (path, p) => {
    expect(path.endsWith(`/${p.id}.json`)).toBe(true);
    const i = sanitizeSort(p.input);
    expect(i).not.toBeNull();
    expect(parseNumbers(i?.tab === 'sort' ? i.values : (i?.searchValues ?? ''))).not.toBeNull();
  });

  it.each(Object.entries(structures))('%s is valid', (path, p) => {
    expect(path.endsWith(`/${p.id}.json`)).toBe(true);
    const i = sanitizeStruct(p.input);
    expect(i).not.toBeNull();
    if (!i) return;
    if (i.tab === 'tree') {
      const ops = parseTreeOps(i.treeOps);
      expect(typeof ops).not.toBe('string');
      expect(treeSteps(ops as TreeOp[], i.treeKind).length).toBeGreaterThan(1);
    } else if (i.tab === 'heap') {
      const ops = parseHeapOps(i.heapOps);
      expect(typeof ops).not.toBe('string');
      expect(heapSteps(ops as HeapOp[], i.heapKind).length).toBeGreaterThan(1);
    } else {
      const ops = parseHashOps(i.hashOps);
      expect(typeof ops).not.toBe('string');
      const steps = hashSteps(ops as HashOp[], i.hashSize, i.hashMethod);
      expect(steps.some((s) => /cannot be inserted/.test(s.label))).toBe(false);
    }
  });

  it.each(Object.entries(graphs))('%s is valid', (path, p) => {
    expect(path.endsWith(`/${p.id}.json`)).toBe(true);
    const i = sanitizeGraph(p.input);
    expect(i).not.toBeNull();
    if (!i) return;
    const g = parseGraph(i.graph, i.directed);
    expect(typeof g).not.toBe('string');
    expect(typeof graphSteps(g as Graph, i.algorithm, i.start)).not.toBe('string');
  });

  it('the AVL rotations preset hits all four cases', () => {
    const p = Object.values(structures).find((x) => x.id === 'avl-rotations') as Preset;
    const i = sanitizeStruct(p.input);
    const labels = treeSteps(parseTreeOps(i?.treeOps ?? '') as TreeOp[], 'avl').map((s) => s.label);
    for (const c of ['LL case', 'RR case', 'LR case', 'RL case']) {
      expect(
        labels.some((l) => l.includes(c)),
        c,
      ).toBe(true);
    }
  });

  it('the selection sort preset really shows instability', () => {
    const p = Object.values(sorting).find((x) => x.id === 'selection-unstable') as Preset;
    const values = parseNumbers(sanitizeSort(p.input)?.values ?? '') as number[];
    // Track the two 5s by position: after selection sort, the one that started first ends second.
    const steps = sortSteps(values, 'selection').steps;
    const swaps = steps.filter((s) => s.label.startsWith('Swap 5 and 2'));
    expect(swaps.length).toBe(1);
  });
});
