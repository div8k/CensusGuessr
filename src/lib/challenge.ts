import { CITY_BY_ID } from './cities';

// A challenge link carries one city as a short code, e.g. ?c=k3x9a2. The code
// is a light scramble so the address bar does not give the answer away; it is
// not a secret. Anything that does not decode to a city in the game is ignored.
const MULTIPLIER = 7919;
const OFFSET = 104729;
const CODE = /^[0-9a-z]{4,9}$/;

export function encodeChallenge(cityId: string): string {
  return (Number(cityId) * MULTIPLIER + OFFSET).toString(36);
}

export function decodeChallenge(code: string | null): string | null {
  if (!code || !CODE.test(code)) return null;
  const n = parseInt(code, 36) - OFFSET;
  if (!Number.isSafeInteger(n) || n <= 0 || n % MULTIPLIER !== 0) return null;
  const id = String(n / MULTIPLIER).padStart(7, '0');
  return CITY_BY_ID.has(id) ? id : null;
}
