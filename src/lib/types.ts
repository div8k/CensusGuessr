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
  ancestry: string;
  otherStatePct: number;
  yearBuilt: number;
  region: Region;
}

export interface Result {
  guessId: string;
  distanceKm: number;
  score: number;
  cluesUsed: number;
}
