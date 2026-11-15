import { describe, expect, it } from 'vitest';
import { CITIES, CITY_BY_ID, cityLabel } from './cities';
import { decodeChallenge, encodeChallenge } from './challenge';
import { CLUES, ordinal } from './clues';
import { DAY_MS, SCHEDULE, cityIdForPuzzle, epochMs, nextResetMs, puzzleNumber } from './daily';
import type { Schedule } from './daily';
import { bearingDeg, compass, haversineKm } from './geo';
import { buildResult, isFinished, scoreGuesses } from './round';
import { scoreGuess, shareText } from './scoring';
import { buildIndex, searchCities } from './search';
import { addDailyToStats } from './storage';

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
  it('makes each extra guess worth 20% less', () => {
    expect(scoreGuess(0, 1, 2)).toBe(4000);
    expect(scoreGuess(0, 1, 3)).toBe(3000);
    expect(scoreGuess(87, 3, 2)).toBe(2689);
  });
  it('formats the share line without the city', () => {
    expect(shareText('daily', 42, 3, 2, 87, 3361)).toBe(
      '🏙️ CensusGuessr #42 · 🧩 3/8 clues · 🎯 2/3 guesses · 📍 87 km · ⭐ 3,361/5,000',
    );
    expect(shareText('challenge', null, 1, 1, 0, 5000)).toContain('CensusGuessr Challenge');
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

describe('direction', () => {
  it('points from a guess toward the answer', () => {
    const at = (name: string) => CITIES.find((c) => c.name === name)!;
    const dir = (from: string, to: string) => {
      const [a, b] = [at(from), at(to)];
      return compass(bearingDeg(a.lat, a.lon, b.lat, b.lon)).direction;
    };
    expect(dir('Miami', 'Washington')).toBe('N');
    expect(dir('Miami', 'Atlanta')).toBe('NW');
    expect(dir('Denver', 'Kansas City')).toBe('E');
    expect(dir('Chicago', 'New Orleans')).toBe('S');
    expect(dir('Dallas', 'El Paso')).toBe('W');
    expect(compass(44).arrow).toBe('↗');
    expect(compass(359).direction).toBe('N');
  });
});

describe('rounds', () => {
  const city = (name: string) => CITIES.find((c) => c.name === name)!;
  const answer = city('Denver');
  it('ends on an exact guess, on the third guess, or when the player stops', () => {
    const miss = { id: city('Miami').id, clues: 1 };
    expect(isFinished(scoreGuesses(answer, [miss]), false)).toBe(false);
    expect(isFinished(scoreGuesses(answer, [miss]), true)).toBe(true);
    expect(isFinished(scoreGuesses(answer, []), true)).toBe(false);
    expect(isFinished(scoreGuesses(answer, [miss, miss, miss]), false)).toBe(true);
    expect(isFinished(scoreGuesses(answer, [miss, { id: answer.id, clues: 2 }]), false)).toBe(true);
  });
  it('scores the best single guess, so another guess never costs points', () => {
    const close = { id: city('Albuquerque').id, clues: 1 };
    const far = { id: city('Miami').id, clues: 1 };
    const one = buildResult(scoreGuesses(answer, [close]), 1)!;
    const two = buildResult(scoreGuesses(answer, [close, far]), 1)!;
    expect(two.score).toBe(one.score);
    expect(two.guessId).toBe(close.id);
    expect(two.guessesUsed).toBe(2);
    const fixed = buildResult(scoreGuesses(answer, [far, { id: answer.id, clues: 1 }]), 1)!;
    expect(fixed.score).toBe(4000);
    expect(fixed.distanceKm).toBe(0);
  });
  it('ignores guesses for cities that are not in the game', () => {
    expect(scoreGuesses(answer, [{ id: '0000000', clues: 1 }])).toHaveLength(0);
  });
});

describe('challenge links', () => {
  it('round-trips every city and hides the id', () => {
    for (const c of CITIES) {
      const code = encodeChallenge(c.id);
      expect(code).toMatch(/^[0-9a-z]{4,9}$/);
      expect(code).not.toContain(c.id);
      expect(decodeChallenge(code)).toBe(c.id);
    }
  });
  it('rejects anything that is not a valid code', () => {
    for (const bad of [null, '', 'abc', '<script>', '../../x', 'zzzzzzzzzz', '0000000', 'ABCDEF']) {
      expect(decodeChallenge(bad)).toBeNull();
    }
    expect(decodeChallenge(encodeChallenge('9999999'))).toBeNull();
  });
});

describe('stats', () => {
  const empty = { played: 0, total: 0, best: 0, streak: 0, maxStreak: 0, lastPuzzle: 0 };
  it('counts consecutive days as a streak and resets after a gap', () => {
    let s = addDailyToStats(empty, 5, 1000);
    s = addDailyToStats(s, 6, 3000);
    expect(s).toMatchObject({ played: 2, total: 4000, best: 3000, streak: 2, maxStreak: 2 });
    s = addDailyToStats(s, 9, 500);
    expect(s).toMatchObject({ played: 3, streak: 1, maxStreak: 2, lastPuzzle: 9 });
  });
  it('never counts the same puzzle twice', () => {
    const s = addDailyToStats(empty, 5, 1000);
    expect(addDailyToStats(s, 5, 4000)).toBe(s);
    expect(addDailyToStats(s, 4, 4000)).toBe(s);
  });
});

describe('clue ranks', () => {
  const city = (name: string) => CITIES.find((c) => c.name === name)!;
  const clue = (key: string) => CLUES.find((c) => c.key === key)!;
  it('ranks from the nearer end', () => {
    expect(clue('pop').rank!(city('New York'))).toBe(`Largest of ${CITIES.length}`);
    expect(clue('pop').rank!(city('Los Angeles'))).toBe(`2nd largest of ${CITIES.length}`);
    expect(clue('pop').rank!(city('Savannah'))).toBe(`Smallest of ${CITIES.length}`);
    expect(clue('transitBikePct').rank!(city('New York'))).toBe(`Highest of ${CITIES.length}`);
  });
  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd'],
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
  it('gives each visitor their own order, stable for that visitor', () => {
    const n = SCHEDULE.versions[0].pool.length;
    const order = (v: string) => Array.from({ length: n }, (_, i) => cityIdForPuzzle(i + 1, SCHEDULE, v));
    const a = order('00112233aabbccdd');
    const b = order('ffeeddcc99887766');
    expect(a).toEqual(order('00112233aabbccdd'));
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBe(n);
    expect(new Set(b).size).toBe(n);
    expect([...a].sort()).toEqual([...b].sort());
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
