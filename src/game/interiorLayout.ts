// The apartment interior lives far outside the map (its own little room); entering = teleport + fade.
export const INTERIOR = {
  x: -40000,
  y: 0,
  z: 40000,
  w: 9,
  d: 7,
  h: 3.1,
  // points of interest inside (relative to x/z)
  bed: { x: 2.6, z: -1.6 },
  door: { x: -3.9, z: 2.6 },
  spawn: { x: -3.0, z: 2.0, heading: Math.PI * 0.75 },
};
