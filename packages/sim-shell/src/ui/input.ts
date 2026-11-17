import { MISSIONS, type HistoryEntry } from '../engine';

export interface ShellInput {
  mission: string;
  /** Every command typed (and every editor save), replayed to rebuild the machine from a link. */
  history: HistoryEntry[];
}

export const DEFAULT_INPUT: ShellInput = { mission: 'basics', history: [] };

export const MAX_HISTORY = 400;

export function sanitizeInput(raw: unknown): ShellInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const history: HistoryEntry[] = [];
  if (Array.isArray(r.history)) {
    for (const h of r.history.slice(0, MAX_HISTORY)) {
      if (typeof h === 'string') history.push(h.slice(0, 2000));
      else if (h && typeof h === 'object') {
        const e = h as Record<string, unknown>;
        if (typeof e.path === 'string' && typeof e.content === 'string') {
          history.push({ path: e.path.slice(0, 500), content: e.content.slice(0, 20000) });
        }
      }
    }
  }
  return {
    mission: MISSIONS.some((m) => m.id === r.mission) ? (r.mission as string) : 'basics',
    history,
  };
}
