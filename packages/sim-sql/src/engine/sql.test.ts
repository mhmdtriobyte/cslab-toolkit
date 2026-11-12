import { createRequire } from 'node:module';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compareResults,
  DATASETS,
  datasetById,
  lastResultSet,
  openDatabase,
  runScript,
  schemaOf,
} from '.';

const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;

beforeAll(async () => {
  const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
  SQL = await initSqlJs({ locateFile: () => wasm });
});

describe('datasets', () => {
  it('every dataset loads with foreign keys on and no violations', () => {
    for (const d of DATASETS) {
      const db = openDatabase(SQL, d.sql);
      const violations = db.exec('PRAGMA foreign_key_check');
      expect(violations, d.id).toEqual([]);
      db.close();
    }
  });

  it('describes tables, keys and row counts', () => {
    const db = openDatabase(SQL, datasetById('university').sql);
    const schema = schemaOf(db);
    const enroll = schema.find((t) => t.name === 'enrollments');
    expect(enroll?.rowCount).toBe(34);
    expect(enroll?.columns.find((c) => c.name === 'student_id')).toMatchObject({
      pk: true,
      references: 'students.student_id',
    });
    expect(schema.map((t) => t.name)).toContain('prerequisites');
  });
});

describe('runScript', () => {
  it('returns one result per statement and counts changes', () => {
    const db = openDatabase(SQL, '');
    const run = runScript(
      db,
      `CREATE TABLE t (x INTEGER);
       INSERT INTO t VALUES (1), (2), (3);
       UPDATE t SET x = x * 10 WHERE x > 1;
       SELECT x FROM t ORDER BY x;`,
    );
    expect(run.error).toBeNull();
    expect(run.results.map((r) => r.changes)).toEqual([0, 3, 2, 0]);
    expect(run.results[3]?.rows).toEqual([[1], [20], [30]]);
  });

  it('stops at the first error and keeps earlier results', () => {
    const db = openDatabase(SQL, datasetById('university').sql);
    const run = runScript(db, 'SELECT 1; SELECT nope FROM students; SELECT 2;');
    expect(run.results).toHaveLength(1);
    expect(run.error?.message).toMatch(/no such column: nope/);
    expect(run.error?.index).toBe(1);
  });

  it('reports syntax errors', () => {
    const db = openDatabase(SQL, '');
    const run = runScript(db, 'SELEC 1;');
    expect(run.error?.message).toMatch(/syntax error/);
  });

  it('enforces foreign keys', () => {
    const db = openDatabase(SQL, datasetById('university').sql);
    const run = runScript(db, 'INSERT INTO enrollments VALUES (999, 1, NULL);');
    expect(run.error?.message).toMatch(/FOREIGN KEY/);
  });

  it('truncates huge results', () => {
    const db = openDatabase(SQL, '');
    const run = runScript(
      db,
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000) SELECT i FROM n;',
      100,
    );
    expect(run.results[0]?.rows).toHaveLength(100);
    expect(run.results[0]?.truncated).toBe(true);
  });
});

describe('compareResults', () => {
  const db = () => openDatabase(SQL, datasetById('university').sql);
  const last = (sql: string) => lastResultSet(runScript(db(), sql));

  it('ignores column aliases and, when unordered, row order', () => {
    const expected = last('SELECT name FROM students WHERE year = 1 ORDER BY name');
    const actual = last('SELECT name AS n FROM students WHERE year = 1 ORDER BY name DESC');
    expect(compareResults(actual, expected!, false).match).toBe(true);
    expect(compareResults(actual, expected!, true).match).toBe(false);
  });

  it('explains a wrong row count', () => {
    const expected = last('SELECT name FROM students WHERE gpa > 3.45');
    const actual = last('SELECT name FROM students WHERE gpa >= 3.45');
    const c = compareResults(actual, expected!, false);
    expect(c.match).toBe(false);
    expect(c.reason).toMatch(/row/);
  });

  it('treats floats that print the same as equal', () => {
    const expected = last('SELECT AVG(gpa) FROM students');
    const actual = last('SELECT SUM(gpa) / COUNT(gpa) FROM students');
    expect(compareResults(actual, expected!, false).match).toBe(true);
  });
});
