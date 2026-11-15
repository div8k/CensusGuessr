export type Region = 'Northeast' | 'Midwest' | 'South' | 'West';

export interface City {
  /** 7-digit state + place FIPS code (Census GEOID). */
  id: string;
  name: string;
  censusName: string;
  state: string;
  stateName: string;
  lat: number;
  lon: number;
  pop: number;
  medianAge: number;
  wfhPct: number;
  homeValue: number;
  transitBikePct: number;
  otherStatePct: number;
  yearBuilt: number;
  region: Region;
}

/** What is saved for a guess: the city and how many clues were showing. */
export interface GuessInput {
  id: string;
  clues: number;
}

/** A guess measured against the answer. */
export interface ScoredGuess extends GuessInput {
  /** 1-based guess number. */
  n: number;
  km: number;
  score: number;
  exact: boolean;
  /** Compass direction from this guess to the answer, e.g. "↗" and "NE". */
  arrow: string;
  direction: string;
}

export interface Result {
  /** The guess that scored best. */
  guessId: string;
  distanceKm: number;
  score: number;
  cluesUsed: number;
  guessesUsed: number;
}

export interface Stats {
  played: number;
  total: number;
  best: number;
  streak: number;
  maxStreak: number;
  /** Puzzle number of the last recorded Daily Challenge (0 = none). */
  lastPuzzle: number;
}
