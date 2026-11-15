import { describe, expect, it } from 'vitest';
import { CITIES, CITY_BY_ID, cityLabel } from './cities';
import { CLUES } from './clues';
import { DAY_MS, SCHEDULE, cityIdForPuzzle, epochMs, nextResetMs, puzzleNumber } from './daily';
import type { Schedule } from './daily';
import { haversineKm } from './geo';
import { scoreGuess, shareText } from './scoring';
import { buildIndex, searchCities } from './search';

describe('scoring', () => {
  it('gives 5,000 for an exact guess on clue one', () => {
    expect(scoreGuess(0, 1)).toBe(5000);
  });
  it('lowers the maximum by 10% per extra clue', () => {
    expect(scoreGuess(0, 2)).toBe(4500);
    expect(scoreGuess(0, 8)).toBe(1500);
  });
  it('still rewards nearby guesses', () => {
    expect(scoreGuess(87, 3)).toBe(3361);
    expect(scoreGuess(500, 1)).toBe(1839);
    expect(scoreGuess(4000, 1)).toBe(2);
  });
  it('formats the share line without the city', () => {
    expect(shareText(42, 3, 87, 3361)).toBe(
      '🏙️ CensusGuessr #42 · 🧩 3/8 clues · 📍 87 km · ⭐ 3,361/5,000',
    );
  });
});

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(40, -100, 40, -100)).toBe(0);
  });
  it('matches a known distance (New York to Los Angeles ≈ 3,936 km)', () => {
    expect(haversineKm(40.7128, -74.006, 34.0522, -118.2437)).toBeGreaterThan(3925);
    expect(haversineKm(40.7128, -74.006, 34.0522, -118.2437)).toBeLessThan(3945);
  });
  it('is symmetric', () => {
    const [a, b] = [CITIES[0], CITIES[CITIES.length - 1]];
    expect(haversineKm(a.lat, a.lon, b.lat, b.lon)).toBeCloseTo(
      haversineKm(b.lat, b.lon, a.lat, a.lon),
      9,
    );
  });
});

describe('daily schedule', () => {
  const epoch = epochMs();
  it('numbers puzzles from 1 with a 00:00 UTC reset', () => {
    expect(puzzleNumber(epoch)).toBe(1);
    expect(puzzleNumber(epoch + DAY_MS - 1)).toBe(1);
    expect(puzzleNumber(epoch + DAY_MS)).toBe(2);
    expect(puzzleNumber(epoch + 41 * DAY_MS + 12345)).toBe(42);
    expect(puzzleNumber(epoch - 5 * DAY_MS)).toBe(1);
  });
  it('computes the next reset', () => {
    expect(nextResetMs(epoch + 1)).toBe(epoch + DAY_MS);
    expect(nextResetMs(epoch + DAY_MS)).toBe(epoch + 2 * DAY_MS);
  });
  it('only schedules cities that exist in the snapshot', () => {
    const latest = SCHEDULE.versions[SCHEDULE.versions.length - 1];
    for (const id of latest.pool) expect(CITY_BY_ID.has(id)).toBe(true);
  });
  it('is deterministic and does not repeat within one pass of the pool', () => {
    const n = SCHEDULE.versions[0].pool.length;
    const ids = Array.from({ length: n }, (_, i) => cityIdForPuzzle(i + 1));
    expect(new Set(ids).size).toBe(n);
    expect(cityIdForPuzzle(7)).toBe(ids[6]);
    expect(Array.from({ length: n }, (_, i) => cityIdForPuzzle(n + i + 1))).not.toEqual(ids);
  });
  it('keeps past puzzles when a new schedule version is appended', () => {
    const next: Schedule = {
      ...SCHEDULE,
      versions: [
        ...SCHEDULE.versions,
        { version: 99, startPuzzle: 50, seed: 'later', pool: SCHEDULE.versions[0].pool.slice(0, 20) },
      ],
    };
    for (let p = 1; p < 50; p++) expect(cityIdForPuzzle(p, next)).toBe(cityIdForPuzzle(p));
    expect(next.versions[1].pool).toContain(cityIdForPuzzle(50, next));
  });
});

describe('data snapshot', () => {
  it('has unique ids and unique "City, ST" labels', () => {
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(CITIES.length);
    expect(new Set(CITIES.map(cityLabel)).size).toBe(CITIES.length);
  });
  it('has a value for every clue of every city', () => {
    expect(CLUES).toHaveLength(8);
    for (const c of CITIES) for (const clue of CLUES) expect(clue.value(c)).toMatch(/\S/);
  });
});

describe('search', () => {
  const index = buildIndex(CITIES);
  const labels = (q: string) => searchCities(index, q).map(cityLabel);
  it('lists every match with its state, biggest first', () => {
    expect(labels('san')).toEqual([
      'San Antonio, TX',
      'San Diego, CA',
      'San Jose, CA',
      'San Francisco, CA',
    ]);
  });
  it('narrows by state', () => {
    expect(labels('las vegas, nv')).toEqual(['Las Vegas, NV']);
    expect(labels('Portland Oregon')).toEqual(['Portland, OR']);
  });
  it('ignores punctuation and case', () => {
    expect(labels('st louis')).toContain('St. Louis, MO');
    expect(labels('NEW orleans')).toEqual(['New Orleans, LA']);
  });
  it('tells same-named cities apart by state', () => {
    const twins = buildIndex([
      { ...CITIES[0], id: 'a', name: 'Springfield', state: 'IL', stateName: 'Illinois' },
      { ...CITIES[0], id: 'b', name: 'Springfield', state: 'MO', stateName: 'Missouri' },
    ]);
    expect(searchCities(twins, 'springfield').map(cityLabel).sort()).toEqual([
      'Springfield, IL',
      'Springfield, MO',
    ]);
    expect(searchCities(twins, 'springfield, mo').map(cityLabel)).toEqual(['Springfield, MO']);
  });
});
