import snapshot from '../data/cities.json';
import type { City } from './types';

export const CITIES = snapshot.cities as City[];
export const META = snapshot.meta;

export const CITY_BY_ID: ReadonlyMap<string, City> = new Map(CITIES.map((c) => [c.id, c]));

/** "Springfield, MO" — unique across the pool (enforced by the data script). */
export const cityLabel = (c: City): string => `${c.name}, ${c.state}`;
export const cityLongLabel = (c: City): string => `${c.name}, ${c.stateName}`;
