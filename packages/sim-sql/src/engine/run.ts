import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

export type Cell = SqlValue;

export interface StatementResult {
  /** The statement as written (trimmed). */
  sql: string;
  columns: string[];
  rows: Cell[][];
  /** Rows inserted, updated or deleted by this statement (0 for a SELECT). */
  changes: number;
  /** More than `maxRows` rows came back; only the first `maxRows` are kept. */
  truncated: boolean;
  /** SELECT-like statement (returns columns), as opposed to DDL / DML. */
  returnsRows: boolean;
}

export interface RunResult {
  results: StatementResult[];
  /** The first error stops the script, like the sqlite3 shell with -bail. */
  error: { message: string; statement: string; index: number } | null;
}

export const MAX_ROWS = 1000;

/** A fresh in-memory database with the dataset loaded and foreign keys enforced. */
export function openDatabase(SQL: SqlJsStatic, datasetSql: string): Database {
  const db = new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  if (datasetSql) db.exec(datasetSql);
  return db;
}

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error:\s*/, '');
}

/** Runs every statement in `script` in order and collects each result set. */
export function runScript(db: Database, script: string, maxRows = MAX_ROWS): RunResult {
  const results: StatementResult[] = [];
  let index = 0;
  let current = '';
  try {
    for (const stmt of db.iterateStatements(script)) {
      current = stmt.getSQL().trim();
      try {
        const columns = stmt.getColumnNames();
        const rows: Cell[][] = [];
        let truncated = false;
        while (stmt.step()) {
          if (rows.length >= maxRows) {
            truncated = true;
            break;
          }
          rows.push(stmt.get());
        }
        results.push({
          sql: current,
          columns,
          rows,
          changes: columns.length === 0 ? db.getRowsModified() : 0,
          truncated,
          returnsRows: columns.length > 0,
        });
      } finally {
        stmt.free();
      }
      index++;
    }
  } catch (e) {
    // A syntax error is thrown by the iterator before `current` is updated: point at the rest.
    return { results, error: { message: cleanError(e), statement: current, index } };
  }
  return { results, error: null };
}

export interface ColumnInfo {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  /** "table.column" this column references, if it is a foreign key. */
  references: string | null;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

function rowsOf(db: Database, sql: string): Cell[][] {
  return db.exec(sql)[0]?.values ?? [];
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Tables, columns, keys and row counts, for the schema browser. */
export function schemaOf(db: Database): TableInfo[] {
  const names = rowsOf(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
  ).map((r) => String(r[0]));
  return names.map((name) => {
    const fks = new Map<string, string>();
    for (const r of rowsOf(db, `PRAGMA foreign_key_list(${quoteIdent(name)})`)) {
      // id, seq, table, from, to, ...
      fks.set(String(r[3]), `${String(r[2])}.${r[4] === null ? '?' : String(r[4])}`);
    }
    const columns = rowsOf(db, `PRAGMA table_info(${quoteIdent(name)})`).map((r) => ({
      // cid, name, type, notnull, dflt_value, pk
      name: String(r[1]),
      type: String(r[2] || 'ANY'),
      notNull: r[3] === 1,
      pk: Number(r[5]) > 0,
      references: fks.get(String(r[1])) ?? null,
    }));
    const rowCount = Number(rowsOf(db, `SELECT COUNT(*) FROM ${quoteIdent(name)}`)[0]?.[0] ?? 0);
    return { name, columns, rowCount };
  });
}

/** The last statement in a run that returned rows: what "your answer" means for an exercise. */
export function lastResultSet(run: RunResult): StatementResult | null {
  for (let i = run.results.length - 1; i >= 0; i--) {
    const r = run.results[i] as StatementResult;
    if (r.returnsRows) return r;
  }
  return null;
}

function normalize(cell: Cell): string {
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : cell.toFixed(6);
  if (cell instanceof Uint8Array) return `blob:${Array.from(cell).join(',')}`;
  return cell === null ? '\u0000null' : `s:${cell}`;
}

export interface Comparison {
  match: boolean;
  reason: string;
}

/**
 * Compares a student's result set with the expected one. Column names are ignored (aliases differ);
 * row order only matters when the exercise asks for ORDER BY.
 */
export function compareResults(
  actual: StatementResult | null,
  expected: StatementResult,
  ordered: boolean,
): Comparison {
  if (!actual) return { match: false, reason: 'Your script did not return any rows to check.' };
  if (actual.columns.length !== expected.columns.length) {
    return {
      match: false,
      reason: `Expected ${expected.columns.length} column(s), your query returned ${actual.columns.length}.`,
    };
  }
  if (actual.rows.length !== expected.rows.length) {
    return {
      match: false,
      reason: `Expected ${expected.rows.length} row(s), your query returned ${actual.rows.length}.`,
    };
  }
  const key = (row: Cell[]) => row.map(normalize).join('\u0001');
  const a = actual.rows.map(key);
  const b = expected.rows.map(key);
  if (ordered) {
    const i = a.findIndex((r, k) => r !== b[k]);
    return i === -1
      ? { match: true, reason: 'Same rows in the same order as the expected answer.' }
      : {
          match: false,
          reason: `Row ${i + 1} differs (check the values${ordered ? ' and the ORDER BY' : ''}).`,
        };
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  const same = sortedA.every((r, k) => r === sortedB[k]);
  return same
    ? { match: true, reason: 'Same rows as the expected answer (order does not matter here).' }
    : { match: false, reason: 'Same number of rows, but some values differ.' };
}

export function formatCell(cell: Cell): string {
  if (cell === null) return 'NULL';
  if (cell instanceof Uint8Array) return `<blob ${cell.length} bytes>`;
  if (typeof cell === 'number' && !Number.isInteger(cell)) {
    return String(Math.round(cell * 1e6) / 1e6);
  }
  return String(cell);
}
