import scheduleJson from '../data/schedule.json';

export const DAY_MS = 86_400_000;

export interface ScheduleVersion {
  version: number;
  /** First puzzle number that uses this version. */
  startPuzzle: number;
  seed: string;
  /** Frozen pool of GEOIDs. Never edit a published version; append a new one. */
  pool: string[];
}
export interface Schedule {
  /** Puzzle #1 starts at 00:00 UTC on this date. Every puzzle lasts one UTC day. */
  epochUtc: string;
  versions: ScheduleVersion[];
}

export const SCHEDULE = scheduleJson as Schedule;

export const epochMs = (s: Schedule = SCHEDULE): number => Date.parse(`${s.epochUtc}T00:00:00Z`);

/** Stable puzzle number: 1 on the epoch day, +1 at every 00:00 UTC. */
export function puzzleNumber(nowMs: number, s: Schedule = SCHEDULE): number {
  return Math.max(1, Math.floor((nowMs - epochMs(s)) / DAY_MS) + 1);
}

/** Timestamp of the next 00:00 UTC reset. */
export const nextResetMs = (nowMs: number): number => (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const rand = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * City GEOID for a puzzle number. Each schedule version plays through a seeded
 * shuffle of its frozen pool, reshuffling after every full pass, so the answer
 * depends only on (puzzle number, schedule, visitor) — never on the current
 * data file. `visitor` is a per-browser random id: every player gets the cities
 * in their own order, and the same player always gets the same order.
 */
export function cityIdForPuzzle(puzzle: number, s: Schedule = SCHEDULE, visitor = ''): string {
  let version = s.versions[0];
  for (const v of s.versions) if (v.startPuzzle <= puzzle) version = v;
  const index = Math.max(0, puzzle - version.startPuzzle);
  const cycle = Math.floor(index / version.pool.length);
  const seed = `${version.seed}:${cycle}${visitor ? `:${visitor}` : ''}`;
  return shuffled(version.pool, seed)[index % version.pool.length];
}
