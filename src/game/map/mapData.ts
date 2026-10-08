// Loads the processed OSM assets (public/data/lagos) and answers geographic queries for gameplay:
// land / water, landuse, district names, road names, chunk index.
import { loadGray, type Gray } from './png';

export const DATA_BASE = `${import.meta.env.BASE_URL}data/lagos/`;

export interface RasterInfo { file: string; x0: number; z0: number; res: number; w: number; h: number; range?: number; classes?: Record<string, number> }
export interface Manifest {
  version: number;
  generated: string;
  attribution: string;
  attributionUrl: string;
  osmBase: string | null;
  origin: { lat: number; lon: number; mPerDegLat: number; mPerDegLon: number };
  chunkSize: number;
  regions: Record<string, { bbox: { s: number; w: number; n: number; e: number }; x0: number; z0: number; x1: number; z1: number }>;
  terrain: Record<string, RasterInfo>;
  landuse: Record<string, RasterInfo>;
  roadNames: string[];
  chunks: Record<string, [number, number, number]>;
}

export interface Road {
  cls: number;
  width: number;
  name: string;
  bridge: boolean;
  oneway: boolean;
  link: boolean;
  pts: Float32Array; // x,z pairs (metres)
  h: Float32Array | null; // deck height per vertex
}

export interface Place { name: string; kind: string; x: number; z: number; lat: number; lon: number; profile: string }
export interface Poi { id: string; name: string; cat: string; lat: number; lon: number; x: number; z: number }

export interface Raster extends RasterInfo { data: Uint8Array }

export class MapData {
  manifest!: Manifest;
  terrain: Record<string, Raster> = {};
  landuse: Record<string, Raster> = {};
  majorRoads: Road[] = [];
  rail: { bridge: boolean; pts: Float32Array; h: Float32Array | null }[] = [];
  places: Place[] = [];
  pois: Poi[] = [];
  private roadGrid = new Map<string, number[]>();
  private static GRID = 200;

  async load(onProgress?: (p: number, label: string) => void) {
    const j = async <T,>(f: string): Promise<T> => {
      const r = await fetch(DATA_BASE + f);
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return r.json();
    };
    onProgress?.(0.05, 'Reading map index');
    this.manifest = await j<Manifest>('manifest.json');
    const steps: Promise<void>[] = [];
    let done = 0;
    const total = Object.keys(this.manifest.terrain).length + Object.keys(this.manifest.landuse).length + 4;
    const tick = (label: string) => onProgress?.(0.1 + (0.8 * ++done) / total, label);
    for (const [k, info] of Object.entries(this.manifest.terrain))
      steps.push(loadGray(DATA_BASE + info.file).then((g: Gray) => { this.terrain[k] = { ...info, data: g.data, w: g.width, h: g.height }; tick('Coastline & lagoon'); }));
    for (const [k, info] of Object.entries(this.manifest.landuse))
      steps.push(loadGray(DATA_BASE + info.file).then((g: Gray) => { this.landuse[k] = { ...info, data: g.data, w: g.width, h: g.height }; tick('Land use'); }));
    steps.push(j<{ roads: number[][] }>('roads_major.json').then((d) => { this.majorRoads = d.roads.map((r) => this.parseMajor(r)); this.indexRoads(); tick('Road network'); }));
    steps.push(j<{ rail: number[][] }>('rail.json').then((d) => {
      this.rail = d.rail.map((r) => {
        const n = r[1];
        const pts = new Float32Array(n * 2);
        for (let i = 0; i < n * 2; i++) pts[i] = r[2 + i] / 10;
        const h = r.length > 2 + n * 2 ? new Float32Array(r.slice(2 + n * 2).map((v) => v / 10)) : null;
        return { bridge: r[0] === 1, pts, h };
      });
      tick('Rail lines');
    }));
    steps.push(j<Place[]>('places.json').then((d) => { this.places = d; tick('Districts'); }));
    steps.push(j<{ pois: Poi[] }>('pois.json').then((d) => { this.pois = d.pois; tick('Places of interest'); }));
    await Promise.all(steps);
    onProgress?.(0.95, 'Building the city');
  }

  private parseMajor(r: number[]): Road {
    const [cls, wdm, ni, flags, n] = r;
    const pts = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) pts[i] = r[5 + i] / 10;
    const bridge = (flags & 1) === 1;
    const h = r.length > 5 + n * 2 ? new Float32Array(r.slice(5 + n * 2).map((v) => v / 10)) : null;
    return { cls, width: wdm / 10, name: this.manifest.roadNames[ni] || '', bridge, oneway: (flags & 2) === 2, link: (flags & 4) === 4, pts, h };
  }

  private indexRoads() {
    const G = MapData.GRID;
    this.majorRoads.forEach((r, ri) => {
      const seen = new Set<string>();
      for (let i = 0; i < r.pts.length; i += 2) {
        const k = `${Math.floor(r.pts[i] / G)},${Math.floor(r.pts[i + 1] / G)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        let a = this.roadGrid.get(k);
        if (!a) this.roadGrid.set(k, (a = []));
        a.push(ri);
      }
    });
  }

  /** major roads with a vertex within ~radius of (x,z) */
  roadsNear(x: number, z: number, radius: number): number[] {
    const G = MapData.GRID;
    const out = new Set<number>();
    const r = Math.ceil(radius / G);
    const cx = Math.floor(x / G), cz = Math.floor(z / G);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) this.roadGrid.get(`${cx + i},${cz + j}`)?.forEach((v) => out.add(v));
    return [...out];
  }

  regionAt(x: number, z: number): string | null {
    for (const [k, b] of Object.entries(this.manifest.regions)) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return k;
    return null;
  }

  /** signed distance to shoreline in metres (+ land, − water); −999 outside the mapped regions */
  sdf(x: number, z: number): number {
    const reg = this.regionAt(x, z);
    if (!reg) return -999;
    const t = this.terrain[reg];
    if (!t) return 50;
    const fx = (x - t.x0) / t.res - 0.5, fz = (z - t.z0) / t.res - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const g = (i: number, j: number) => {
      const xi = Math.min(t.w - 1, Math.max(0, i)), zj = Math.min(t.h - 1, Math.max(0, j));
      return t.data[zj * t.w + xi];
    };
    const v = (g(ix, iz) * (1 - tx) + g(ix + 1, iz) * tx) * (1 - tz) + (g(ix, iz + 1) * (1 - tx) + g(ix + 1, iz + 1) * tx) * tz;
    return ((v - 128) / 127) * (t.range ?? 48);
  }

  isWater(x: number, z: number) {
    return this.sdf(x, z) < 0;
  }

  landuseAt(x: number, z: number): number {
    const reg = this.regionAt(x, z);
    if (!reg) return 0;
    const t = this.landuse[reg];
    if (!t) return 0;
    const i = Math.floor((x - t.x0) / t.res), j = Math.floor((z - t.z0) / t.res);
    if (i < 0 || j < 0 || i >= t.w || j >= t.h) return 0;
    return t.data[j * t.w + i];
  }

  /** District label: nearest suburb / neighbourhood / quarter node (OSM place=*) */
  areaName(x: number, z: number): string {
    let best = '', bd = Infinity;
    for (const p of this.places) {
      if (!['suburb', 'quarter', 'neighbourhood', 'island', 'town'].includes(p.kind)) continue;
      const w = p.kind === 'suburb' || p.kind === 'town' ? 0.8 : p.kind === 'island' ? 1.3 : 1;
      const d = Math.hypot(p.x - x, p.z - z) * w;
      if (d < bd) { bd = d; best = p.name; }
    }
    return bd < 3500 ? best : '';
  }

  nearestMajorRoad(x: number, z: number, maxDist = 60): { road: Road; dist: number } | null {
    let best: Road | null = null, bd = maxDist;
    for (const ri of this.roadsNear(x, z, maxDist)) {
      const r = this.majorRoads[ri];
      const d = distToPolyline(r.pts, x, z) - r.width / 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best ? { road: best, dist: bd } : null;
  }
}

export function distToPolyline(p: Float32Array, x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
    const dx = bx - ax, dz = bz - az;
    const L = dx * dx + dz * dz;
    let t = L > 0 ? ((x - ax) * dx + (z - az) * dz) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}

export const mapData = new MapData();
