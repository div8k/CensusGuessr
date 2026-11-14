export const MAX_SCORE = 5000;
export const TOTAL_CLUES = 8;

/** Share of the maximum still available after revealing `cluesUsed` clues. */
export const clueMultiplier = (cluesUsed: number): number => 1 - 0.1 * (cluesUsed - 1);

export function scoreGuess(distanceKm: number, cluesUsed: number): number {
  return Math.round(5000 * Math.exp(-distanceKm / 500) * (1 - 0.10 * (cluesUsed - 1)));
}

const int = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Spoiler-free share line; `puzzle` is null for Practice rounds. */
export function shareText(
  puzzle: number | null,
  cluesUsed: number,
  distanceKm: number,
  score: number,
): string {
  const title = puzzle === null ? 'CensusGuessr Practice' : `CensusGuessr #${puzzle}`;
  return `🏙️ ${title} · 🧩 ${cluesUsed}/${TOTAL_CLUES} clues · 📍 ${int(distanceKm)} km · ⭐ ${int(score)}/${int(MAX_SCORE)}`;
}
