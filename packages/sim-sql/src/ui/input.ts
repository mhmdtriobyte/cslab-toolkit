import { DATASETS } from '../engine';

export interface SqlExercise {
  prompt: string;
  solution: string;
  /** Row order matters (the task asks for ORDER BY). */
  ordered: boolean;
}

export interface SqlInput {
  dataset: string;
  query: string;
  exercise: SqlExercise | null;
}

export const DEFAULT_INPUT: SqlInput = {
  dataset: 'university',
  query: `-- Ctrl+Enter runs the whole script on a fresh copy of the database.
SELECT s.name, d.name AS major, s.gpa
FROM students AS s
LEFT JOIN departments AS d ON d.dept_id = s.major_dept
ORDER BY s.gpa DESC;`,
  exercise: null,
};

const MAX_SQL = 20000;

function sanitizeExercise(v: unknown): SqlExercise | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.prompt !== 'string' || typeof r.solution !== 'string') return null;
  return {
    prompt: r.prompt.slice(0, 2000),
    solution: r.solution.slice(0, MAX_SQL),
    ordered: r.ordered === true,
  };
}

export function sanitizeInput(raw: unknown): SqlInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    dataset: DATASETS.some((d) => d.id === r.dataset) ? (r.dataset as string) : 'university',
    query: typeof r.query === 'string' ? r.query.slice(0, MAX_SQL) : DEFAULT_INPUT.query,
    exercise: sanitizeExercise(r.exercise),
  };
}
