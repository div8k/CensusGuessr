import { CITY_BY_ID } from './cities';
import { MAX_SCORE, TOTAL_CLUES } from './scoring';
import type { Result } from './types';

const KEY = 'censusguessr.daily.v1';
/** Half the Earth's circumference: no two points are farther apart. */
const MAX_DISTANCE_KM = 20_100;

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
    // Saved data is treated as untrusted: every field is range-checked before use.
    const s = JSON.parse(raw) as Partial<DailySave> | null;
    if (typeof s !== 'object' || s === null) return null;
    if (s.puzzle !== puzzle || s.answerId !== answerId) return null;
    const clues = Number(s.cluesRevealed);
    if (!Number.isInteger(clues) || clues < 1 || clues > TOTAL_CLUES) return null;
    let result: Result | null = null;
    const r = s.result;
    if (r) {
      if (
        !CITY_BY_ID.has(r.guessId) ||
        typeof r.distanceKm !== 'number' ||
        !(r.distanceKm >= 0 && r.distanceKm <= MAX_DISTANCE_KM) ||
        !Number.isInteger(r.score) ||
        r.score < 0 ||
        r.score > MAX_SCORE ||
        !Number.isInteger(r.cluesUsed) ||
        r.cluesUsed < 1 ||
        r.cluesUsed > TOTAL_CLUES
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
