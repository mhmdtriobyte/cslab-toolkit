import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {
  lastResultSet,
  openDatabase,
  runScript,
  schemaOf,
  type RunResult,
  type StatementResult,
  type TableInfo,
} from '../engine';

export interface SqlRequest {
  datasetSql: string;
  script: string;
  /** Exercise solution, run on its own fresh copy of the database. */
  solution: string | null;
}

export interface SqlResponse {
  run: RunResult;
  /** Schema after the script ran, so new tables show up. */
  schema: TableInfo[];
  expected: StatementResult | null;
  expectedError: string | null;
  ms: number;
}

const ready = initSqlJs({ locateFile: () => wasmUrl });

self.onmessage = async (e: MessageEvent<SqlRequest>) => {
  const SQL = await ready;
  const { datasetSql, script, solution } = e.data;
  const db = openDatabase(SQL, datasetSql);
  const t0 = performance.now();
  const run = runScript(db, script);
  const ms = performance.now() - t0;
  const schema = schemaOf(db);
  db.close();
  let expected: StatementResult | null = null;
  let expectedError: string | null = null;
  if (solution) {
    const sdb = openDatabase(SQL, datasetSql);
    const srun = runScript(sdb, solution);
    sdb.close();
    expected = lastResultSet(srun);
    expectedError = srun.error?.message ?? null;
  }
  const response: SqlResponse = { run, schema, expected, expectedError, ms };
  self.postMessage(response);
};
