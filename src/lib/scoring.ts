export const MAX_SCORE = 5000;
export const TOTAL_CLUES = 8;
export const MAX_GUESSES = 3;

/** Share of the maximum still available after revealing `cluesUsed` clues. */
export const clueMultiplier = (cluesUsed: number): number => 1 - 0.1 * (cluesUsed - 1);
/** Share of the maximum available on guess number `guess` (1, 0.8, 0.6). */
export const guessMultiplier = (guess: number): number => 1 - 0.2 * (guess - 1);

/**
 * Points for one guess. The first-guess rule is the original formula; later
 * guesses are worth 20% less each. A round scores its best single guess, so an
 * extra guess can never lower the score.
 */
export function scoreGuess(distanceKm: number, cluesUsed: number, guess = 1): number {
  return Math.round(
    5000 * Math.exp(-distanceKm / 500) * (1 - 0.10 * (cluesUsed - 1)) * guessMultiplier(guess),
  );
}

const int = (n: number): string => Math.round(n).toLocaleString('en-US');

export type RoundKind = 'daily' | 'practice' | 'challenge';

/** Spoiler-free share line. `puzzle` is only used for the Daily Challenge. */
export function shareText(
  kind: RoundKind,
  puzzle: number | null,
  cluesUsed: number,
  guessesUsed: number,
  distanceKm: number,
  score: number,
): string {
  const title =
    kind === 'daily'
      ? `CensusGuessr #${puzzle}`
      : kind === 'challenge'
        ? 'CensusGuessr Challenge'
        : 'CensusGuessr Practice';
  return `🏙️ ${title} · 🧩 ${cluesUsed}/${TOTAL_CLUES} clues · 🎯 ${guessesUsed}/${MAX_GUESSES} guesses · 📍 ${int(distanceKm)} km · ⭐ ${int(score)}/${int(MAX_SCORE)}`;
}
