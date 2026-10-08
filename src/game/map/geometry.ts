// Pure geometry builders (no DOM, no three.js scene objects) — used by the chunk worker and the main thread.
// Output is plain typed arrays so it can be transferred from a worker without copies.
import { Earcut } from 'three/src/extras/Earcut.js';
import { FACADE, WALL_TINTS, ROOF_TINTS_ZINC } from './facadeCells';

export class GeoBuf {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  extra: number[] = []; // per-vertex extra attribute (layer / facade cells)
  idx: number[] = [];
  constructor(public extraSize = 0, public withUv = false) {}
  get count() {
    return this.pos.length / 3;
  }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RGB, u = 0, w = 0, e0 = 0, e1 = 0) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(c[0], c[1], c[2]);
    if (this.withUv) this.uv.push(u, w);
    if (this.extraSize >= 1) this.extra.push(e0);
    if (this.extraSize >= 2) this.extra.push(e1);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  pack(): PackedGeo {
    const count = this.count;
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      color: new Float32Array(this.col),
      uv: this.withUv ? new Float32Array(this.uv) : null,
      extra: this.extraSize ? new Float32Array(this.extra) : null,
      extraSize: this.extraSize,
      index: count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
    };
  }
}

export interface PackedGeo {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  uv: Float32Array | null;
  extra: Float32Array | null;
  extraSize: number;
  index: Uint32Array | Uint16Array;
}

export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  // sRGB -> linear (three.js works in linear; vertex colours are linear)
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function rand(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ------------------------------------------------------------------ roads
export const ROAD_STYLE: Record<number, { asphalt: string; side?: number; gutter?: number; marks?: boolean; lift: number }> = {
  0: { asphalt: '#34363a', side: 0, gutter: 0.6, marks: true, lift: 0 },
  1: { asphalt: '#37393c', side: 2.2, gutter: 0.6, marks: true, lift: 0 },
  2: { asphalt: '#3b3d40', side: 2.2, gutter: 0.6, marks: true, lift: 0 },
  3: { asphalt: '#3f4144', side: 1.8, gutter: 0.6, marks: true, lift: 0 },
  4: { asphalt: '#45474a', side: 1.6, gutter: 0.6, marks: true, lift: 0 },
  5: { asphalt: '#4a4b4c', side: 1.2, gutter: 0.6, lift: 0 },
  6: { asphalt: '#4f5051', gutter: 0.7, lift: 0 },
  7: { asphalt: '#575756', lift: 0 },
  8: { asphalt: '#9b958a', lift: 0 },
  9: { asphalt: '#a59d8f', lift: 0 },
  10: { asphalt: '#8f6a4c', lift: 0 },
};
const SIDEWALK = hex('#aaa498');
const GUTTER = hex('#3a3936');
const MARK_W = hex('#e9e7df');
const MARK_Y = hex('#e3b93c');
const DECK = hex('#8d8a84');
const DECK_DARK = hex('#6e6b66');

export interface RoadIn {
  cls: number;
  width: number;
  oneway: boolean;
  bridge: boolean;
  unpaved?: boolean;
  link?: boolean;
  pts: ArrayLike<number>; // x,z pairs (local coords for the buffer)
  h: ArrayLike<number> | null;
}

/** layer ids — the vertex shader turns these into a depth bias so overlapping flat layers never z-fight */
export const L_SIDE = 1, L_GUTTER = 2, L_ASPH = 3, L_MARK = 4;

function stripOffsets(pts: ArrayLike<number>) {
  const n = pts.length / 2;
  const nx = new Float32Array(n), nz = new Float32Array(n), sc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dx0 = 0, dz0 = 0, dx1 = 0, dz1 = 0;
    if (i > 0) {
      dx0 = pts[i * 2] - pts[i * 2 - 2];
      dz0 = pts[i * 2 + 1] - pts[i * 2 - 1];
      const l = Math.hypot(dx0, dz0) || 1;
      dx0 /= l; dz0 /= l;
    }
    if (i < n - 1) {
      dx1 = pts[i * 2 + 2] - pts[i * 2];
      dz1 = pts[i * 2 + 3] - pts[i * 2 + 1];
      const l = Math.hypot(dx1, dz1) || 1;
      dx1 /= l; dz1 /= l;
    }
    if (i === 0) { dx0 = dx1; dz0 = dz1; }
    if (i === n - 1) { dx1 = dx0; dz1 = dz0; }
    let tx = dx0 + dx1, tz = dz0 + dz1;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = dx1; tz = dz1; } else { tx /= tl; tz /= tl; }
    // left normal of tangent
    nx[i] = -tz;
    nz[i] = tx;
    const cos = Math.max(0.35, tx * dx1 + tz * dz1);
    sc[i] = 1 / cos;
  }
  return { nx, nz, sc };
}

function strip(b: GeoBuf, pts: ArrayLike<number>, hs: ArrayLike<number> | null, half: number, y: number, c: RGB, layer: number, vary = 0) {
  const n = pts.length / 2;
  if (n < 2) return;
  const { nx, nz, sc } = stripOffsets(pts);
  const base = b.count;
  let along = 0;
  for (let i = 0; i < n; i++) {
    if (i) along += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const yy = y + (hs ? hs[i] : 0);
    const o = half * Math.min(sc[i], 2.5);
    const cc = vary ? shade(c, 1 + vary * Math.sin(along * 0.045 + x * 0.013) * Math.sin(along * 0.011 + z * 0.02)) : c;
    b.v(x + nx[i] * o, yy, z + nz[i] * o, 0, 1, 0, cc, 0, 0, layer);
    b.v(x - nx[i] * o, yy, z - nz[i] * o, 0, 1, 0, cc, 0, 0, layer);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    b.tri(a, a + 2, a + 1);
    b.tri(a + 1, a + 2, a + 3);
  }
}

/** dashed line of quads at lateral offset `off` */
function dashes(b: GeoBuf, pts: ArrayLike<number>, hs: ArrayLike<number> | null, off: number, w: number, dash: number, gap: number, y: number, c: RGB) {
  const n = pts.length / 2;
  let carry = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const nx = -dz, nz = dx;
    const ha = hs ? hs[i] : 0, hb = hs ? hs[i + 1] : 0;
    let t = carry;
    while (t < L) {
      const t1 = Math.min(L, t + dash);
      const x0 = ax + dx * t + nx * off, z0 = az + dz * t + nz * off;
      const x1 = ax + dx * t1 + nx * off, z1 = az + dz * t1 + nz * off;
      const y0 = y + ha + (hb - ha) * (t / L), y1 = y + ha + (hb - ha) * (t1 / L);
      const s = b.count;
      b.v(x0 + nx * w, y0, z0 + nz * w, 0, 1, 0, c, 0, 0, L_MARK);
      b.v(x0 - nx * w, y0, z0 - nz * w, 0, 1, 0, c, 0, 0, L_MARK);
      b.v(x1 + nx * w, y1, z1 + nz * w, 0, 1, 0, c, 0, 0, L_MARK);
      b.v(x1 - nx * w, y1, z1 - nz * w, 0, 1, 0, c, 0, 0, L_MARK);
      b.tri(s, s + 2, s + 1);
      b.tri(s + 1, s + 2, s + 3);
      t = t1 + gap;
    }
    carry = t - L;
  }
}

export interface RoadBuild {
  surface: PackedGeo; // vertex colours + layer attribute
  bridge: PackedGeo; // deck structure, parapets, piers
  collider: { vertices: Float32Array; indices: Uint32Array } | null; // bridge decks + parapets
  lamps: number[]; // x, y, z, rotY ... streetlight placements
}

export function buildRoads(roads: RoadIn[], opts: { lamps?: boolean } = {}): RoadBuild {
  const S = new GeoBuf(1);
  const Bd = new GeoBuf(0);
  const col: number[] = [];
  const colIdx: number[] = [];
  const lamps: number[] = [];
  // draw order inside a layer: minor first so major asphalt paints over (same layer, later = on top with equal depth)
  const order = [...roads].sort((a, b) => b.cls - a.cls);
  for (const r of order) {
    const st = ROAD_STYLE[r.cls] ?? ROAD_STYLE[6];
    const half = r.width / 2;
    const y0 = 0.02;
    const hs = r.h;
    const raised = !!hs && Array.from(hs).some((v) => v > 0.5);
    if (st.side && !raised) strip(S, r.pts, hs, half + st.side + (st.gutter ?? 0), y0, SIDEWALK, L_SIDE, 0.04);
    if (st.gutter && !raised) strip(S, r.pts, hs, half + st.gutter, y0 + 0.004, GUTTER, L_GUTTER);
    const asphalt = r.unpaved ? hex('#94704f') : hex(st.asphalt);
    strip(S, r.pts, hs, half, y0 + 0.008, asphalt, L_ASPH, r.cls >= 5 ? 0.12 : 0.06);
    if (st.marks && r.width >= 6.5) {
      if (!r.oneway) dashes(S, r.pts, hs, 0, 0.09, 3, 5, y0 + 0.012, r.cls <= 1 ? MARK_Y : MARK_W);
      else {
        const lanes = Math.max(1, Math.round(r.width / 3.5));
        for (let l = 1; l < lanes; l++) dashes(S, r.pts, hs, -half + (r.width * l) / lanes, 0.07, 3, 6, y0 + 0.012, MARK_W);
      }
      // edge lines
      dashes(S, r.pts, hs, half - 0.35, 0.06, 1e6, 0, y0 + 0.012, MARK_W);
      dashes(S, r.pts, hs, -half + 0.35, 0.06, 1e6, 0, y0 + 0.012, MARK_W);
    }
    if (raised && hs) bridgeStructure(Bd, r.pts, hs, half, col, colIdx);
    if (opts.lamps && r.cls <= 4 && !r.link) placeLamps(lamps, r.pts, hs, half + (st.side ? st.side * 0.5 + (st.gutter ?? 0) : 0.8), r.oneway, raised);
  }
  return {
    surface: S.pack(),
    bridge: Bd.pack(),
    collider: col.length ? { vertices: new Float32Array(col), indices: new Uint32Array(colIdx) } : null,
    lamps,
  };
}

function bridgeStructure(b: GeoBuf, pts: ArrayLike<number>, hs: ArrayLike<number>, half: number, col: number[], colIdx: number[]) {
  const n = pts.length / 2;
  const { nx, nz, sc } = stripOffsets(pts);
  const thick = 1.1;
  const par = 0.95; // parapet height
  const pw = 0.35;
  const base = b.count;
  // per vertex ring: [outerL top, outerL bottom, outerR top, outerR bottom, parapet L top in, parapet R top in]
  const ring = (i: number) => {
    const x = pts[i * 2], z = pts[i * 2 + 1], y = hs[i] + 0.02;
    const o = (half + pw) * Math.min(sc[i], 2.5);
    const oi = half * Math.min(sc[i], 2.5);
    return {
      lx: x + nx[i] * o, lz: z + nz[i] * o, rx: x - nx[i] * o, rz: z - nz[i] * o,
      lix: x + nx[i] * oi, liz: z + nz[i] * oi, rix: x - nx[i] * oi, riz: z - nz[i] * oi, y,
    };
  };
  const rings = Array.from({ length: n }, (_, i) => ring(i));
  // deck underside + side faces + parapets as quads between consecutive rings
  const quad = (a: number[], bq: number[], c: number[], d: number[], color: RGB, collide: boolean) => {
    // a,b,c,d: [x,y,z] in order around the quad
    const ux = bq[0] - a[0], uy = bq[1] - a[1], uz = bq[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
    const l = Math.hypot(nx2, ny2, nz2) || 1;
    nx2 /= l; ny2 /= l; nz2 /= l;
    const s = b.count;
    for (const p of [a, bq, c, d]) b.v(p[0], p[1], p[2], nx2, ny2, nz2, color);
    b.tri(s, s + 1, s + 2);
    b.tri(s, s + 2, s + 3);
    if (collide) {
      const cs = col.length / 3;
      for (const p of [a, bq, c, d]) col.push(p[0], p[1], p[2]);
      colIdx.push(cs, cs + 1, cs + 2, cs, cs + 2, cs + 3);
    }
  };
  for (let i = 0; i < n - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    if (A.y < 0.3 && B.y < 0.3) continue;
    // deck walking surface for the collider (asphalt drawn by strip())
    {
      const cs = col.length / 3;
      col.push(A.lix, A.y, A.liz, A.rix, A.y, A.riz, B.rix, B.y, B.riz, B.lix, B.y, B.liz);
      colIdx.push(cs, cs + 1, cs + 2, cs, cs + 2, cs + 3);
    }
    // parapet tops + sides (concrete barriers)
    quad([A.lx, A.y + par, A.lz], [B.lx, B.y + par, B.lz], [B.lix, B.y + par, B.liz], [A.lix, A.y + par, A.liz], DECK, false);
    quad([A.rix, A.y + par, A.riz], [B.rix, B.y + par, B.riz], [B.rx, B.y + par, B.rz], [A.rx, A.y + par, A.rz], DECK, false);
    quad([A.lix, A.y, A.liz], [A.lix, A.y + par, A.liz], [B.lix, B.y + par, B.liz], [B.lix, B.y, B.liz], DECK, true);
    quad([B.rix, B.y, B.riz], [B.rix, B.y + par, B.riz], [A.rix, A.y + par, A.riz], [A.rix, A.y, A.riz], DECK, true);
    // outer faces down to the underside
    quad([B.lx, B.y - thick, B.lz], [B.lx, B.y + par, B.lz], [A.lx, A.y + par, A.lz], [A.lx, A.y - thick, A.lz], DECK_DARK, false);
    quad([A.rx, A.y - thick, A.rz], [A.rx, A.y + par, A.rz], [B.rx, B.y + par, B.rz], [B.rx, B.y - thick, B.rz], DECK_DARK, false);
    // underside
    quad([A.lx, A.y - thick, A.lz], [A.rx, A.y - thick, A.rz], [B.rx, B.y - thick, B.rz], [B.lx, B.y - thick, B.lz], DECK_DARK, false);
  }
  // piers every ~32 m where the deck is high
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const L = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]);
    let t = 32 - acc;
    while (t < L) {
      const f = t / L;
      const x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * f;
      const z = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * f;
      const y = hs[i] + (hs[i + 1] - hs[i]) * f;
      if (y > 2.2) pier(b, x, z, y - 1.1, half * 0.55, nx[i], nz[i]);
      t += 32;
    }
    acc = (acc + L) % 32;
  }
  void base;
}

function pier(b: GeoBuf, x: number, z: number, top: number, spread: number, nx: number, nz: number) {
  const c = hex('#7c7972');
  for (const s of [-1, 1]) {
    const px = x + nx * spread * s, pz = z + nz * spread * s;
    box(b, px, -3, pz, 0.7, top + 3, 0.7, c);
  }
}

export function box(b: GeoBuf, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, c: RGB, rotY = 0) {
  const hx = sx / 2, hz = sz / 2;
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const P = (x: number, y: number, z: number): [number, number, number] => [cx + x * cs + z * sn, y0 + y, cz - x * sn + z * cs];
  const faces: [number[], [number, number, number][]][] = [
    [[0, 0, 1], [P(-hx, 0, hz), P(hx, 0, hz), P(hx, sy, hz), P(-hx, sy, hz)]],
    [[0, 0, -1], [P(hx, 0, -hz), P(-hx, 0, -hz), P(-hx, sy, -hz), P(hx, sy, -hz)]],
    [[1, 0, 0], [P(hx, 0, hz), P(hx, 0, -hz), P(hx, sy, -hz), P(hx, sy, hz)]],
    [[-1, 0, 0], [P(-hx, 0, -hz), P(-hx, 0, hz), P(-hx, sy, hz), P(-hx, sy, -hz)]],
    [[0, 1, 0], [P(-hx, sy, hz), P(hx, sy, hz), P(hx, sy, -hz), P(-hx, sy, -hz)]],
  ];
  for (const [n0, q] of faces) {
    const rx = n0[0] * cs + n0[2] * sn, rz = -n0[0] * sn + n0[2] * cs;
    const s = b.count;
    for (const p of q) b.v(p[0], p[1], p[2], rx, n0[1], rz, n0[1] > 0 ? c : shade(c, 0.85));
    b.tri(s, s + 1, s + 2);
    b.tri(s, s + 2, s + 3);
  }
}

function placeLamps(out: number[], pts: ArrayLike<number>, hs: ArrayLike<number> | null, off: number, oneway: boolean, raised: boolean) {
  const n = pts.length / 2;
  let acc = 0;
  let side = 1;
  const spacing = 34;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    let t = spacing - acc;
    while (t < L) {
      const s = oneway ? 1 : side;
      const x = ax + dx * t - dz * off * s;
      const z = az + dz * t + dx * off * s;
      const y = hs ? hs[i] + (hs[i + 1] - hs[i]) * (t / L) : 0;
      // rotation so the arm points over the road
      const rot = Math.atan2(dz * s, -dx * s);
      out.push(x, raised ? y : 0, z, rot);
      side = -side;
      t += spacing;
    }
    acc = (acc + L) % spacing;
  }
}

// ------------------------------------------------------------------ buildings
export interface BuildingBuild {
  walls: PackedGeo; // uv = (bays, floors); extra = (groundCell, upperCell)
  roofs: PackedGeo;
  collider: { vertices: Float32Array; indices: Uint32Array };
  tanks: number[]; // x, y, z, kind
  domes: number[]; // x, y, z, radius
  count: number;
}

const ROOF_FLAT = hex('#a19b90');
const ROOF_FLAT2 = hex('#8f8a82');

/** buildings: chunk records [arch, hDm, levels, roof, seed, n, x0, z0, ...] (dm, chunk-local) */
export function buildBuildings(recs: number[][], ox: number, oz: number): BuildingBuild {
  const W = new GeoBuf(2, true);
  const Rf = new GeoBuf(0);
  const cv: number[] = [];
  const ci: number[] = [];
  const tanks: number[] = [];
  const domes: number[] = [];
  for (const r of recs) {
    const [arch, hdm, levels, roof, seed, n] = r;
    const rnd = rand(seed * 31 + arch);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(ox + r[6 + i * 2] / 10, oz + r[7 + i * 2] / 10);
    let h = hdm / 10;
    if (arch === 7) h = Math.min(h, 3.2);
    const floors = Math.max(1, levels);
    const fac = FACADE[arch] ?? FACADE[1];
    const gi = fac.ground[Math.floor(rnd() * fac.ground.length)];
    const ui = fac.upper[Math.floor(rnd() * fac.upper.length)];
    const tint = arch === 4 ? hex('#e9edf0') : arch === 6 ? hex(['#d8dad6', '#c9cfd2', '#d6cbb8'][Math.floor(rnd() * 3)]) : hex(WALL_TINTS[Math.floor(rnd() * WALL_TINTS.length)]);
    const floorH = h / floors;
    // walls
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const bays = Math.max(1, Math.round(L / (arch === 4 ? 2.6 : 3.1)));
      const f = h / floorH;
      const s = W.count;
      W.v(ax, 0, az, nx, 0, nz, tint, 0, 0, gi, ui);
      W.v(bx, 0, bz, nx, 0, nz, tint, bays, 0, gi, ui);
      W.v(bx, h, bz, nx, 0, nz, tint, bays, f, gi, ui);
      W.v(ax, h, az, nx, 0, nz, tint, 0, f, gi, ui);
      W.tri(s, s + 2, s + 1);
      W.tri(s, s + 3, s + 2);
      const c0 = cv.length / 3;
      cv.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
      ci.push(c0, c0 + 2, c0 + 1, c0, c0 + 3, c0 + 2);
    }
    // roof
    const roofCol = roof === 0 ? (rnd() < 0.5 ? ROOF_FLAT : ROOF_FLAT2) : hex(ROOF_TINTS_ZINC[Math.floor(rnd() * ROOF_TINTS_ZINC.length)]);
    if (roof >= 3) {
      flatRoof(Rf, pts, h, shade(tint, 0.9));
      parapet(Rf, pts, h, shade(tint, 0.92), 0.8);
      landmarkRoof(Rf, roof, pts, h, rnd, tint);
      continue;
    }
    const done = roof !== 0 && n === 4 ? hipRoof(Rf, pts, h, roofCol, roof === 2 ? 'gable' : 'hip', tint) : roof === 1 && n <= 8 && convex(pts) ? pyramidRoof(Rf, pts, h, roofCol) : false;
    if (!done) {
      flatRoof(Rf, pts, h, roofCol);
      parapet(Rf, pts, h, shade(tint, 0.92), arch === 4 ? 0.9 : 0.55);
      if (arch !== 4 && arch !== 6 && arch !== 7 && rnd() < 0.55) {
        // black / blue plastic water tanks — every Lagos roof has one
        const [cx, cz] = centroidOf(pts);
        const k = Math.floor(rnd() * n);
        const tx = cx + (pts[k * 2] - cx) * 0.55, tz = cz + (pts[k * 2 + 1] - cz) * 0.55;
        tanks.push(tx, h, tz, rnd() < 0.7 ? 0 : 1);
      }
    }
  }
  return {
    walls: W.pack(),
    roofs: Rf.pack(),
    collider: { vertices: new Float32Array(cv), indices: new Uint32Array(ci) },
    tanks,
    domes,
    count: recs.length,
  };
}

function centroidOf(p: number[]): [number, number] {
  let x = 0, z = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) { x += p[i * 2]; z += p[i * 2 + 1]; }
  return [x / n, z / n];
}
function convex(p: number[]) {
  const n = p.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n, c = (i + 2) % n;
    const cr = (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[b * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[b * 2]);
    if (Math.abs(cr) < 1e-6) continue;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

function flatRoof(b: GeoBuf, pts: number[], h: number, c: RGB) {
  const tris = Earcut.triangulate(pts, undefined, 2);
  const s = b.count;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) b.v(pts[i * 2], h, pts[i * 2 + 1], 0, 1, 0, c);
  // earcut returns CW/CCW depending on input; make faces point up
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], bb = tris[i + 1], cc = tris[i + 2];
    const cr = (pts[bb * 2] - pts[a * 2]) * (pts[cc * 2 + 1] - pts[a * 2 + 1]) - (pts[bb * 2 + 1] - pts[a * 2 + 1]) * (pts[cc * 2] - pts[a * 2]);
    if (cr < 0) b.tri(s + a, s + bb, s + cc);
    else b.tri(s + a, s + cc, s + bb);
  }
}

function parapet(b: GeoBuf, pts: number[], h: number, c: RGB, ph: number) {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L;
    const s = b.count;
    b.v(ax, h, az, nx, 0, nz, c);
    b.v(bx, h, bz, nx, 0, nz, c);
    b.v(bx, h + ph, bz, nx, 0, nz, c);
    b.v(ax, h + ph, az, nx, 0, nz, c);
    b.tri(s, s + 2, s + 1);
    b.tri(s, s + 3, s + 2);
    // inner face (seen from above)
    const t = b.count;
    const ic = shade(c, 0.8);
    b.v(ax, h, az, -nx, 0, -nz, ic);
    b.v(bx, h, bz, -nx, 0, -nz, ic);
    b.v(bx, h + ph, bz, -nx, 0, -nz, ic);
    b.v(ax, h + ph, az, -nx, 0, -nz, ic);
    b.tri(t, t + 1, t + 2);
    b.tri(t, t + 2, t + 3);
  }
}

function faceTri(b: GeoBuf, a: number[], c1: number[], c2: number[], col: RGB) {
  const ux = c1[0] - a[0], uy = c1[1] - a[1], uz = c1[2] - a[2];
  const vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; [c1, c2] = [c2, c1]; }
  const l = Math.hypot(nx, ny, nz) || 1;
  const s = b.count;
  const sh = 0.82 + 0.18 * (ny / l); // slight face shading variety
  for (const p of [a, c1, c2]) b.v(p[0], p[1], p[2], nx / l, ny / l, nz / l, shade(col, sh));
  b.tri(s, s + 1, s + 2);
}

function vertFace(b: GeoBuf, a: number[], c1: number[], c2: number[], col: RGB) {
  // vertical triangle (gable end), facing away from centroid handled by caller ordering
  const ux = c1[0] - a[0], uy = c1[1] - a[1], uz = c1[2] - a[2];
  const vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  const s = b.count;
  for (const p of [a, c1, c2]) b.v(p[0], p[1], p[2], nx / l, ny / l, nz / l, col);
  b.tri(s, s + 1, s + 2);
}

/** Hip (or gable) roof for 4-sided footprints, with a small overhang. */
function hipRoof(b: GeoBuf, pts: number[], h: number, c: RGB, kind: 'hip' | 'gable', wallTint: RGB): boolean {
  const P = [0, 1, 2, 3].map((i) => [pts[i * 2], pts[i * 2 + 1]]);
  const e01 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
  const e12 = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
  // reject strongly non-rectangular quads
  const d02 = Math.hypot(P[2][0] - P[0][0], P[2][1] - P[0][1]);
  const d13 = Math.hypot(P[3][0] - P[1][0], P[3][1] - P[1][1]);
  if (Math.abs(d02 - d13) > 0.15 * Math.max(d02, d13)) return false;
  // overhang: push corners outward from centroid
  const [cx, cz] = centroidOf(pts);
  const ov = 0.45;
  const Q = P.map(([x, z]) => {
    const dx = x - cx, dz = z - cz;
    const l = Math.hypot(dx, dz) || 1;
    return [x + (dx / l) * ov * 1.41, z + (dz / l) * ov * 1.41];
  });
  // long axis
  const longFirst = e01 >= e12; // edges 0-1 and 2-3 are long
  const short = Math.min(e01, e12), long = Math.max(e01, e12);
  const rise = Math.min(4, short * 0.2 + 0.4);
  const y = h;
  // ridge endpoints: midpoints of the short edges moved inwards by short/2 (hip) or 0 (gable)
  const mid = (a: number[], bb: number[]) => [(a[0] + bb[0]) / 2, (a[1] + bb[1]) / 2];
  let r0: number[], r1: number[];
  if (longFirst) { r0 = mid(Q[1], Q[2]); r1 = mid(Q[3], Q[0]); } else { r0 = mid(Q[0], Q[1]); r1 = mid(Q[2], Q[3]); }
  const ins = kind === 'hip' ? Math.min(short / 2, long / 2 - 0.01) : 0;
  const rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]) || 1;
  const rx = (r1[0] - r0[0]) / rl, rz = (r1[1] - r0[1]) / rl;
  const R0 = [r0[0] + rx * ins, y + rise, r0[1] + rz * ins];
  const R1 = [r1[0] - rx * ins, y + rise, r1[1] - rz * ins];
  const q = Q.map(([x, z]) => [x, y, z]);
  if (longFirst) {
    // long sides: q0-q1 and q2-q3; short ends q1-q2 (near R0), q3-q0 (near R1)
    faceTri(b, q[0], q[1], R0, c); faceTri(b, q[0], R0, R1, c);
    faceTri(b, q[2], q[3], R1, c); faceTri(b, q[2], R1, R0, c);
    if (kind === 'hip') { faceTri(b, q[1], q[2], R0, c); faceTri(b, q[3], q[0], R1, c); }
    else { vertFace(b, q[1], q[2], R0, wallTint); vertFace(b, q[3], q[0], R1, wallTint); vertFace(b, q[2], q[1], R0, wallTint); vertFace(b, q[0], q[3], R1, wallTint); }
  } else {
    faceTri(b, q[1], q[2], R1, c); faceTri(b, q[1], R1, R0, c);
    faceTri(b, q[3], q[0], R0, c); faceTri(b, q[3], R0, R1, c);
    if (kind === 'hip') { faceTri(b, q[0], q[1], R0, c); faceTri(b, q[2], q[3], R1, c); }
    else { vertFace(b, q[0], q[1], R0, wallTint); vertFace(b, q[2], q[3], R1, wallTint); vertFace(b, q[1], q[0], R0, wallTint); vertFace(b, q[3], q[2], R1, wallTint); }
  }
  // underside of the overhang (so the roof doesn't look paper-thin from street level)
  const under = shade(c, 0.45);
  const s = b.count;
  for (const p of q) b.v(p[0], p[1] - 0.05, p[2], 0, -1, 0, under);
  b.tri(s, s + 1, s + 2);
  b.tri(s, s + 2, s + 3);
  b.tri(s, s + 2, s + 1);
  b.tri(s, s + 3, s + 2);
  return true;
}

function pyramidRoof(b: GeoBuf, pts: number[], h: number, c: RGB): boolean {
  const n = pts.length / 2;
  const [cx, cz] = centroidOf(pts);
  let minR = Infinity;
  for (let i = 0; i < n; i++) minR = Math.min(minR, Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cz));
  const apex = [cx, h + Math.min(3.5, minR * 0.35 + 0.3), cz];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2] + (pts[i * 2] - cx) * 0.06, az = pts[i * 2 + 1] + (pts[i * 2 + 1] - cz) * 0.06;
    const bx = pts[j * 2] + (pts[j * 2] - cx) * 0.06, bz = pts[j * 2 + 1] + (pts[j * 2 + 1] - cz) * 0.06;
    faceTri(b, [ax, h, az], [bx, h, bz], apex, c);
  }
  return true;
}


/** vertical frustum (r0 at y0 -> r1 at y1), optional top cap */
function frustum(b: GeoBuf, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, seg: number, c: RGB, top = false) {
  const s = b.count;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const slope = (r0 - r1) / Math.max(0.01, y1 - y0);
    const nl = Math.hypot(1, slope);
    b.v(cx + ca * r0, y0, cz + sa * r0, ca / nl, slope / nl, sa / nl, c);
    b.v(cx + ca * r1, y1, cz + sa * r1, ca / nl, slope / nl, sa / nl, c);
  }
  for (let i = 0; i < seg; i++) {
    const a = s + i * 2;
    b.tri(a, a + 1, a + 2);
    b.tri(a + 1, a + 3, a + 2);
  }
  if (top && r1 > 0.01) {
    const ci = b.v(cx, y1, cz, 0, 1, 0, c);
    const t0 = b.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      b.v(cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, 0, 1, 0, c);
    }
    for (let i = 0; i < seg; i++) b.tri(ci, t0 + i + 1, t0 + i);
  }
}

/** hemisphere-ish dome */
function dome(b: GeoBuf, cx: number, y: number, cz: number, r: number, c: RGB, rows = 5, seg = 14) {
  for (let j = 0; j < rows; j++) {
    const p0 = (j / rows) * Math.PI / 2, p1 = ((j + 1) / rows) * Math.PI / 2;
    frustum(b, cx, cz, y + Math.sin(p0) * r, y + Math.sin(p1) * r, Math.cos(p0) * r, Math.max(0.001, Math.cos(p1) * r), seg, shade(c, 0.9 + 0.1 * (j / rows)));
  }
}

function landmarkRoof(b: GeoBuf, kind: number, pts: number[], h: number, rnd: () => number, tint: RGB) {
  const [cx, cz] = centroidOf(pts);
  const n = pts.length / 2;
  let rMean = 0;
  for (let i = 0; i < n; i++) rMean += Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cz);
  rMean /= n;
  if (kind === 3) {
    // mosque: green dome + gold finial + a minaret at the corner furthest from the centre
    const r = Math.min(9, rMean * 0.45);
    frustum(b, cx, cz, h, h + r * 0.35, r, r, 16, hex('#e8e2d2'));
    dome(b, cx, h + r * 0.35, cz, r, hex('#2f8a5a'));
    frustum(b, cx, cz, h + r * 1.35, h + r * 1.35 + 1.4, 0.18, 0.02, 6, hex('#d8b240'));
    let far = 0, fi = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cz);
      if (d > far) { far = d; fi = i; }
    }
    const mx = cx + (pts[fi * 2] - cx) * 0.85, mz = cz + (pts[fi * 2 + 1] - cz) * 0.85;
    const mh = h + Math.max(14, r * 3);
    frustum(b, mx, mz, 0, mh, 1.5, 1.2, 8, hex('#efe9da'));
    frustum(b, mx, mz, mh, mh + 1.2, 2.0, 2.0, 8, hex('#e2dccb'), true);
    frustum(b, mx, mz, mh + 1.2, mh + 4.5, 1.1, 0.05, 8, hex('#2f8a5a'));
  } else if (kind === 4) {
    // church: steeple on the end furthest from the centre
    let far = 0, fi = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cz);
      if (d > far) { far = d; fi = i; }
    }
    const tx = cx + (pts[fi * 2] - cx) * 0.7, tz = cz + (pts[fi * 2 + 1] - cz) * 0.7;
    const th = h + Math.max(10, rMean * 0.9);
    box(b, tx, 0, tz, 5, th, 5, tint);
    frustum(b, tx, tz, th, th + 9, 3.6, 0.1, 4, hex('#5d4a3e'));
    frustum(b, tx, tz, th + 9, th + 10.5, 0.1, 0.1, 4, hex('#d8b240'));
  } else if (kind === 5) {
    // National Arts Theatre (Iganmu): the famous "military cap" silhouette
    const R = rMean;
    const white = hex('#e9e6dd'), band = hex('#7d8b94');
    frustum(b, cx, cz, h, h + 1.2, R * 1.1, R * 1.16, 32, band);
    frustum(b, cx, cz, h + 1.2, h + 8, R * 1.16, R * 0.66, 32, white);
    frustum(b, cx, cz, h + 8, h + 15, R * 0.66, R * 0.6, 32, hex('#d9d4c6'));
    frustum(b, cx, cz, h + 15, h + 17, R * 0.6, R * 0.2, 32, white, true);
    void rnd;
  }
}

// ------------------------------------------------------------------ walls / fences
export function buildWalls(recs: number[][], ox: number, oz: number): PackedGeo {
  const b = new GeoBuf(0);
  for (const r of recs) {
    const [kind, n] = r;
    if (kind === 2) continue;
    const H = kind === 0 ? 2.3 : 1.8;
    const T = kind === 0 ? 0.22 : 0.08;
    const c = kind === 0 ? hex(['#d9d2c3', '#cfc6b3', '#e2dccd', '#bfb7a6'][r.length % 4]) : hex('#56605a');
    for (let i = 0; i < n - 1; i++) {
      const ax = ox + r[2 + i * 2] / 10, az = oz + r[3 + i * 2] / 10, bx = ox + r[4 + i * 2] / 10, bz = oz + r[5 + i * 2] / 10;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.1) continue;
      box(b, (ax + bx) / 2, 0, (az + bz) / 2, L + T, H, T, c, Math.atan2(-(bz - az), bx - ax));
      if (kind === 0) box(b, (ax + bx) / 2, H, (az + bz) / 2, L + T + 0.06, 0.08, T + 0.08, shade(c, 0.85), Math.atan2(-(bz - az), bx - ax));
    }
  }
  return b.pack();
}

// ------------------------------------------------------------------ chunk
export interface ChunkJson {
  b: number[][];
  r: number[][]; // [cls, wDm, nameIdx, flags, n, x.., z.., (h..)]
  w: number[][];
  t: number[]; // x,z,kind (dm)
  n: string[];
}

export interface ChunkBuild {
  key: string;
  buildings: BuildingBuild;
  roads: RoadBuild;
  walls: PackedGeo;
  trees: number[]; // x, z, kind, scale, rot
  props: number[]; // x, z, rot, kind  (0 power pole, 1-4 kiosk colours, 5 parked car, 6 parked keke, 7 umbrella stall)
  roadLines: { name: string; cls: number; pts: number[] }[];
}

/** bounding boxes of building footprints for quick "is this spot free?" checks */
function footprintIndex(recs: number[][], ox: number, oz: number) {
  return recs.map((r) => {
    const n = r[5];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = ox + r[6 + i * 2] / 10, z = oz + r[7 + i * 2] / 10;
      pts.push(x, z);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    return { x0, x1, z0, z1, pts };
  });
}

function insideAny(fp: ReturnType<typeof footprintIndex>, x: number, z: number, pad: number) {
  for (const f of fp) {
    if (x < f.x0 - pad || x > f.x1 + pad || z < f.z0 - pad || z > f.z1 + pad) continue;
    if (pad > 0) return true; // conservative: near the bbox counts as occupied
    let c = false;
    const p = f.pts, n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if ((p[i * 2 + 1] > z) !== (p[j * 2 + 1] > z) && x < ((p[j * 2] - p[i * 2]) * (z - p[i * 2 + 1])) / (p[j * 2 + 1] - p[i * 2 + 1]) + p[i * 2]) c = !c;
    }
    if (c) return true;
  }
  return false;
}

/** street furniture along minor roads: power poles, kiosks, parked cars / kekes, umbrella stalls */
function streetProps(roads: RoadIn[], fp: ReturnType<typeof footprintIndex>, seed: number) {
  const out: number[] = [];
  const rnd = rand(seed);
  for (const r of roads) {
    if (r.cls < 5 || r.cls > 7 || (r.h && Array.from(r.h).some((v) => v > 0.3))) continue;
    const pts = r.pts;
    const n = pts.length / 2;
    let acc = rnd() * 30;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      const rx = -dz, rz = dx;
      while (acc < L) {
        const x = ax + dx * acc, z = az + dz * acc;
        const roll = rnd();
        const side = rnd() < 0.5 ? 1 : -1;
        const half = r.width / 2;
        if (r.cls <= 6 && roll < 0.42) {
          const off = half + 1.0;
          const px = x + rx * off * side, pz = z + rz * off * side;
          if (!insideAny(fp, px, pz, 0)) out.push(px, pz, Math.atan2(dx, dz), 0);
        } else if (roll < 0.56) {
          const off = half + 2.6;
          const px = x + rx * off * side, pz = z + rz * off * side;
          if (!insideAny(fp, px, pz, 1.4)) out.push(px, pz, Math.atan2(-rx * side, -rz * side), 1 + Math.floor(rnd() * 4));
        } else if (roll < 0.66) {
          const off = half - 1.0;
          const px = x + rx * off * side, pz = z + rz * off * side;
          out.push(px, pz, Math.atan2(dx, dz) + (side < 0 ? Math.PI : 0), rnd() < 0.65 ? 5 : 6);
        } else if (roll < 0.7 && r.cls <= 6) {
          const off = half + 2.2;
          const px = x + rx * off * side, pz = z + rz * off * side;
          if (!insideAny(fp, px, pz, 1.2)) out.push(px, pz, rnd() * 6.28, 7);
        }
        acc += 22 + rnd() * 18;
      }
      acc -= L;
    }
  }
  return out;
}

export function buildChunk(key: string, data: ChunkJson, ox: number, oz: number): ChunkBuild {
  const roadsIn: RoadIn[] = [];
  const roadLines: ChunkBuild['roadLines'] = [];
  for (const r of data.r) {
    const [cls, wdm, ni, flags, n] = r;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(ox + r[5 + i * 2] / 10, oz + r[6 + i * 2] / 10);
    const h = r.length > 5 + n * 2 ? r.slice(5 + n * 2).map((v) => v / 10) : null;
    roadsIn.push({ cls, width: wdm / 10, oneway: (flags & 2) === 2, bridge: (flags & 1) === 1, unpaved: (flags & 8) === 8, pts, h });
    if (data.n[ni]) roadLines.push({ name: data.n[ni], cls, pts });
  }
  const trees: number[] = [];
  const rnd = rand(key.length * 977 + data.t.length);
  for (let i = 0; i < data.t.length; i += 3) {
    trees.push(ox + data.t[i] / 10, oz + data.t[i + 1] / 10, data.t[i + 2], 0.75 + rnd() * 0.6, rnd() * Math.PI * 2);
  }
  const fp = footprintIndex(data.b, ox, oz);
  return {
    key,
    buildings: buildBuildings(data.b, ox, oz),
    roads: buildRoads(roadsIn),
    walls: buildWalls(data.w, ox, oz),
    trees,
    props: streetProps(roadsIn, fp, key.length * 131 + data.b.length),
    roadLines,
  };
}

export { mix, shade };
