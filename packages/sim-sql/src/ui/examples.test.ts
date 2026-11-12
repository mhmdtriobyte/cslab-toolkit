import { createRequire } from 'node:module';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeInput } from './input';
import { compareResults, datasetById, lastResultSet, openDatabase, runScript } from '../engine';

interface Preset {
  id: string;
  input: unknown;
}

const presets = import.meta.glob<Preset>('../../../../examples/sql/*.json', {
  eager: true,
  import: 'default',
});

const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;
beforeAll(async () => {
  const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
  SQL = await initSqlJs({ locateFile: () => wasm });
});

describe('sql presets', () => {
  it.each(Object.entries(presets))('%s is valid', (path, preset) => {
    expect(path.endsWith(`/${preset.id}.json`)).toBe(true);
    const input = sanitizeInput(preset.input);
    expect(input).not.toBeNull();
    if (!input) return;
    const run = runScript(openDatabase(SQL, datasetById(input.dataset).sql), input.query);
    if (preset.id === 'ddl-constraints') {
      // Deliberately fails on the CHECK constraint after the valid statements.
      expect(run.error?.message).toMatch(/CHECK/);
    } else {
      expect(run.error).toBeNull();
    }
    if (input.exercise) {
      const solution = runScript(
        openDatabase(SQL, datasetById(input.dataset).sql),
        input.exercise.solution,
      );
      expect(solution.error).toBeNull();
      const expected = lastResultSet(solution);
      expect(expected?.rows.length).toBeGreaterThan(0);
      expect(compareResults(expected, expected!, input.exercise.ordered).match).toBe(true);
      // The starter script must not already be the answer.
      expect(compareResults(lastResultSet(run), expected!, false).match).toBe(false);
    }
  });
});
