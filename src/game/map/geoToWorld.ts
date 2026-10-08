// One transform for everything: OSM lat/lon  <->  local game metres.
// Local tangent plane (equirectangular) centred near Lagos Island / Ikoyi, so Three.js works with small numbers.
//   +X = east, -Z = north (so "north" is forward for an unrotated camera looking down -Z), 1 unit = 1 metre.
// The same constants are used by scripts/build_map.py — keep them in sync (they are also written into manifest.json).

export const ORIGIN = { lat: 6.45, lon: 3.41 } as const;
const R = 6378137;
const DEG = Math.PI / 180;
export const M_PER_DEG_LAT = R * DEG;
export const M_PER_DEG_LON = R * DEG * Math.cos(ORIGIN.lat * DEG);

export function geoToWorld(lat: number, lon: number): { x: number; z: number } {
  return { x: (lon - ORIGIN.lon) * M_PER_DEG_LON, z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT };
}

export function worldToGeo(x: number, z: number): { lat: number; lon: number } {
  return { lat: ORIGIN.lat - z / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}

/** compass heading (0 = north, clockwise) from a world-space direction */
export function headingDeg(dx: number, dz: number) {
  return ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
}
