const EARTH_RADIUS_KM = 6371.0088; // IUGG mean Earth radius
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres (Haversine formula). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing from point 1 to point 2, in degrees clockwise from north. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Nearest of the eight compass points for a bearing. */
export function compass(deg: number): { arrow: string; direction: string } {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return { arrow: ARROWS[i], direction: POINTS[i] };
}

export const KM_PER_MILE = 1.609344;
