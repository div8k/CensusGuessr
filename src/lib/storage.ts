import { CITY_BY_ID } from './cities';
import { MAX_GUESSES, MAX_SCORE, TOTAL_CLUES } from './scoring';
import type { GuessInput, Stats } from './types';

// Everything read back from the browser is treated as untrusted input: each
// field is type- and range-checked, and anything malformed is discarded.
// Distances and scores are never stored; they are recomputed from the guesses.
const DAILY_KEY = 'censusguessr.daily.v2';
const STATS_KEY = 'censusguessr.stats.v1';
const VISITOR_KEY = 'censusguessr.visitor.v1';
const VISITOR_ID = /^[0-9a-f]{16}$/;
let visitor: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A random id for this browser, used only to shuffle the city order for this
 * player. It never leaves the device. If storage is unavailable the id lasts
 * for the page visit.
 */
export function visitorId(): string {
  if (visitor) return visitor;
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && VISITOR_ID.test(saved)) return (visitor = saved);
    visitor = randomId();
    localStorage.setItem(VISITOR_KEY, visitor);
  } catch {
    visitor ??= randomId();
  }
  return visitor;
}

export interface DailySave {
  puzzle: number;
  answerId: string;
  cluesRevealed: number;
  guesses: GuessInput[];
  /** True once the round is over (including when the player stopped early). */
  finished: boolean;
}

function readObject(key: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function saveDaily(save: DailySave): void {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(save));
  } catch {
    // Storage can be unavailable (private mode, quota); the game still works.
  }
}

/** Saved state for `puzzle`, or null if absent, stale, or malformed. */
export function loadDaily(puzzle: number, answerId: string): DailySave | null {
  try {
    const s = readObject(DAILY_KEY);
    if (!s || s.puzzle !== puzzle || s.answerId !== answerId) return null;
    if (!isInt(s.cluesRevealed, 1, TOTAL_CLUES)) return null;
    if (!Array.isArray(s.guesses) || s.guesses.length > MAX_GUESSES) return null;
    const guesses: GuessInput[] = [];
    for (const g of s.guesses as unknown[]) {
      if (typeof g !== 'object' || g === null) return null;
      const { id, clues } = g as Record<string, unknown>;
      if (typeof id !== 'string' || !CITY_BY_ID.has(id)) return null;
      if (!isInt(clues, 1, s.cluesRevealed)) return null;
      guesses.push({ id, clues });
    }
    return {
      puzzle,
      answerId,
      cluesRevealed: s.cluesRevealed,
      guesses,
      finished: s.finished === true && guesses.length > 0,
    };
  } catch {
    return null;
  }
}

const EMPTY_STATS: Stats = { played: 0, total: 0, best: 0, streak: 0, maxStreak: 0, lastPuzzle: 0 };
const MAX_DAYS = 100_000;

export function loadStats(): Stats {
  try {
    const s = readObject(STATS_KEY);
    if (
      !s ||
      !isInt(s.played, 0, MAX_DAYS) ||
      !isInt(s.total, 0, MAX_DAYS * MAX_SCORE) ||
      !isInt(s.best, 0, MAX_SCORE) ||
      !isInt(s.streak, 0, MAX_DAYS) ||
      !isInt(s.maxStreak, 0, MAX_DAYS) ||
      !isInt(s.lastPuzzle, 0, MAX_DAYS)
    ) {
      return { ...EMPTY_STATS };
    }
    return {
      played: s.played,
      total: s.total,
      best: s.best,
      streak: s.streak,
      maxStreak: s.maxStreak,
      lastPuzzle: s.lastPuzzle,
    };
  } catch {
    return { ...EMPTY_STATS };
  }
}

/** Pure update: add one finished Daily Challenge. A puzzle already counted is ignored. */
export function addDailyToStats(stats: Stats, puzzle: number, score: number): Stats {
  if (puzzle <= stats.lastPuzzle) return stats;
  const streak = stats.lastPuzzle === puzzle - 1 ? stats.streak + 1 : 1;
  return {
    played: stats.played + 1,
    total: stats.total + score,
    best: Math.max(stats.best, score),
    streak,
    maxStreak: Math.max(stats.maxStreak, streak),
    lastPuzzle: puzzle,
  };
}

export function recordDaily(puzzle: number, score: number): Stats {
  const next = addDailyToStats(loadStats(), puzzle, score);
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    // Stats are a nicety; ignore storage failures.
  }
  return next;
}
