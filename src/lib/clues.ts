import { CITIES } from './cities';
import type { City } from './types';

export interface Clue {
  key: string;
  label: string;
  /** Prominent value shown to the player. */
  value: (c: City) => string;
  /** Unit / denominator, shown small next to the value. */
  unit: string;
  /** Median across the whole city pool, for context. Null when not numeric. */
  typical: string | null;
}

const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;
const pct = (n: number): string => `${n.toFixed(1)}%`;

function median(pick: (c: City) => number): number {
  const v = CITIES.map(pick).sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
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
    typical: median((c) => c.medianAge).toFixed(1),
  },
  {
    key: 'wfhPct',
    label: 'Work from home',
    value: (c) => pct(c.wfhPct),
    unit: 'of workers',
    typical: pct(median((c) => c.wfhPct)),
  },
  {
    key: 'homeValue',
    label: 'Median home value',
    value: (c) => homeValue(c.homeValue),
    unit: 'owner-occupied homes',
    typical: homeValue(Math.round(median((c) => c.homeValue) / 100) * 100),
  },
  {
    key: 'transitBikePct',
    label: 'Bike or public transit to work',
    value: (c) => pct(c.transitBikePct),
    unit: 'of workers',
    typical: pct(median((c) => c.transitBikePct)),
  },
  {
    key: 'ancestry',
    label: 'Most common reported ancestry',
    value: (c) => c.ancestry,
    unit: '',
    typical: null,
  },
  {
    key: 'otherStatePct',
    label: 'Born in a different U.S. state',
    value: (c) => pct(c.otherStatePct),
    unit: 'of residents',
    typical: pct(median((c) => c.otherStatePct)),
  },
  {
    key: 'yearBuilt',
    label: 'Median year housing was built',
    value: (c) => yearBuilt(c.yearBuilt),
    unit: '',
    typical: yearBuilt(Math.round(median((c) => c.yearBuilt))),
  },
  {
    key: 'region',
    label: 'Census region',
    value: (c) => c.region,
    unit: '',
    typical: null,
  },
];
