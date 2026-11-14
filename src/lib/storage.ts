import { CITY_BY_ID } from './cities';
import { TOTAL_CLUES } from './scoring';
import type { Result } from './types';

const KEY = 'censusguessr.daily.v1';

export interface DailySave {
  puzzle: number;
  answerId: string;
  cluesRevealed: number;
  result: Result | null;
}

export function saveDaily(save: DailySave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage can be unavailable (private mode, quota); the game still works.
  }
}

/** Saved state for `puzzle`, or null if absent, stale, or malformed. */
export function loadDaily(puzzle: number, answerId: string): DailySave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<DailySave>;
    if (s.puzzle !== puzzle || s.answerId !== answerId) return null;
    const clues = Number(s.cluesRevealed);
    if (!Number.isInteger(clues) || clues < 1 || clues > TOTAL_CLUES) return null;
    let result: Result | null = null;
    const r = s.result;
    if (r) {
      if (
        !CITY_BY_ID.has(r.guessId) ||
        !Number.isFinite(r.distanceKm) ||
        !Number.isFinite(r.score) ||
        !Number.isInteger(r.cluesUsed)
      ) {
        return null;
      }
      result = { guessId: r.guessId, distanceKm: r.distanceKm, score: r.score, cluesUsed: r.cluesUsed };
    }
    return { puzzle, answerId, cluesRevealed: clues, result };
  } catch {
    return null;
  }
}
