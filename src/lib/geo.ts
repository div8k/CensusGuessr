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

export const KM_PER_MILE = 1.609344;
