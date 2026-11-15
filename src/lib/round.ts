import { CITY_BY_ID } from './cities';
import { bearingDeg, compass, haversineKm } from './geo';
import { MAX_GUESSES, scoreGuess } from './scoring';
import type { City, GuessInput, Result, ScoredGuess } from './types';

/** Measure each guess against the answer. Unknown city ids are dropped. */
export function scoreGuesses(answer: City, guesses: readonly GuessInput[]): ScoredGuess[] {
  const out: ScoredGuess[] = [];
  for (const g of guesses) {
    const city = CITY_BY_ID.get(g.id);
    if (!city) continue;
    const n = out.length + 1;
    const exact = city.id === answer.id;
    const km = exact ? 0 : haversineKm(city.lat, city.lon, answer.lat, answer.lon);
    const { arrow, direction } = compass(bearingDeg(city.lat, city.lon, answer.lat, answer.lon));
    out.push({ ...g, n, km, exact, score: scoreGuess(km, g.clues, n), arrow, direction });
  }
  return out;
}

/** The guess that counts: highest score, then closest, then earliest. */
export function bestGuess(scored: readonly ScoredGuess[]): ScoredGuess | null {
  let best: ScoredGuess | null = null;
  for (const g of scored) {
    if (!best || g.score > best.score || (g.score === best.score && g.km < best.km)) best = g;
  }
  return best;
}

/** A round ends on an exact guess, after the last allowed guess, or when the player stops. */
export function isFinished(scored: readonly ScoredGuess[], stopped: boolean): boolean {
  return scored.some((g) => g.exact) || scored.length >= MAX_GUESSES || (stopped && scored.length > 0);
}

export function buildResult(scored: readonly ScoredGuess[], cluesRevealed: number): Result | null {
  const best = bestGuess(scored);
  if (!best) return null;
  return {
    guessId: best.id,
    distanceKm: best.km,
    score: best.score,
    cluesUsed: cluesRevealed,
    guessesUsed: scored.length,
  };
}
