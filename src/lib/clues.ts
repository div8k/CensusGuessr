import { CITIES } from './cities';
import type { City } from './types';

export interface Clue {
  key: string;
  label: string;
  /** Prominent value shown to the player. */
  value: (c: City) => string;
  /** Unit / denominator, shown small next to the value. */
  unit: string;
  /** Where the value ranks among the game's cities, e.g. "9th youngest of 60". */
  rank: ((c: City) => string) | null;
  /** Median across the game's cities, for context. Null when not numeric. */
  typical: string | null;
}

const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;
const pct = (n: number): string => `${n.toFixed(1)}%`;

function median(pick: (c: City) => number): number {
  const v = CITIES.map(pick).sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/**
 * Rank among the game's cities, counted from whichever end is nearer:
 * "Highest of 60", "3rd highest of 60", "9th lowest of 60". Ties share a rank.
 */
function ranker(pick: (c: City) => number, high: string, low: string): (c: City) => string {
  const values = CITIES.map(pick);
  return (c) => {
    const v = pick(c);
    const above = values.filter((x) => x > v).length;
    const below = values.filter((x) => x < v).length;
    const [place, word] = above <= below ? [above + 1, high] : [below + 1, low];
    const text = place === 1 ? word : `${ordinal(place)} ${word}`;
    return `${text[0].toUpperCase()}${text.slice(1)} of ${values.length}`;
  };
}

export const HOME_VALUE_CAP = 2_000_000;
export const YEAR_BUILT_FLOOR = 1939;

const homeValue = (n: number): string => (n >= HOME_VALUE_CAP ? `${usd(HOME_VALUE_CAP)}+` : usd(n));
const yearBuilt = (n: number): string => (n <= YEAR_BUILT_FLOOR ? '1939 or earlier' : String(n));

/** The eight clues, in reveal order. */
export const CLUES: Clue[] = [
  {
    key: 'medianAge',
    label: 'Median age',
    value: (c) => c.medianAge.toFixed(1),
    unit: 'years',
    rank: ranker((c) => c.medianAge, 'oldest', 'youngest'),
    typical: median((c) => c.medianAge).toFixed(1),
  },
  {
    key: 'wfhPct',
    label: 'Work from home',
    value: (c) => pct(c.wfhPct),
    unit: 'of workers',
    rank: ranker((c) => c.wfhPct, 'highest', 'lowest'),
    typical: pct(median((c) => c.wfhPct)),
  },
  {
    key: 'homeValue',
    label: 'Median home value',
    value: (c) => homeValue(c.homeValue),
    unit: 'owner-occupied homes',
    rank: ranker((c) => c.homeValue, 'most expensive', 'least expensive'),
    typical: homeValue(Math.round(median((c) => c.homeValue) / 100) * 100),
  },
  {
    key: 'transitBikePct',
    label: 'Bike or public transit to work',
    value: (c) => pct(c.transitBikePct),
    unit: 'of workers',
    rank: ranker((c) => c.transitBikePct, 'highest', 'lowest'),
    typical: pct(median((c) => c.transitBikePct)),
  },
  {
    key: 'pop',
    label: 'Population',
    value: (c) => c.pop.toLocaleString('en-US'),
    unit: 'residents',
    rank: ranker((c) => c.pop, 'largest', 'smallest'),
    typical: (Math.round(median((c) => c.pop) / 1000) * 1000).toLocaleString('en-US'),
  },
  {
    key: 'otherStatePct',
    label: 'Born in a different U.S. state',
    value: (c) => pct(c.otherStatePct),
    unit: 'of residents',
    rank: ranker((c) => c.otherStatePct, 'highest', 'lowest'),
    typical: pct(median((c) => c.otherStatePct)),
  },
  {
    key: 'yearBuilt',
    label: 'Median year housing was built',
    value: (c) => yearBuilt(c.yearBuilt),
    unit: '',
    rank: ranker((c) => c.yearBuilt, 'newest', 'oldest'),
    typical: yearBuilt(Math.round(median((c) => c.yearBuilt))),
  },
  {
    key: 'region',
    label: 'Census region',
    value: (c) => c.region,
    unit: '',
    rank: null,
    typical: null,
  },
];
