import type { City } from './types';

/** Lowercase, strip accents and punctuation: "St. Louis, MO" -> "st louis mo". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Indexed {
  city: City;
  name: string;
  /** "springfield mo" */
  short: string;
  /** "springfield missouri" */
  long: string;
  state: string;
}

export function buildIndex(cities: readonly City[]): Indexed[] {
  return cities.map((city) => ({
    city,
    name: normalize(city.name),
    short: normalize(`${city.name} ${city.state}`),
    long: normalize(`${city.name} ${city.stateName}`),
    state: normalize(city.stateName),
  }));
}

/** Rank: name prefix, then word prefix, then substring, then state name. Ties by population. */
export function searchCities(index: readonly Indexed[], query: string, limit = 8): City[] {
  const q = normalize(query);
  if (!q) return [];
  const hits: { city: City; rank: number }[] = [];
  for (const e of index) {
    let rank = -1;
    if (e.short.startsWith(q) || e.long.startsWith(q)) rank = 0;
    else if (` ${e.name}`.includes(` ${q}`)) rank = 1;
    else if (e.short.includes(q) || e.long.includes(q)) rank = 2;
    else if (e.state.startsWith(q) || e.city.state.toLowerCase() === q) rank = 3;
    if (rank >= 0) hits.push({ city: e.city, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.city.pop - a.city.pop);
  return hits.slice(0, limit).map((h) => h.city);
}
