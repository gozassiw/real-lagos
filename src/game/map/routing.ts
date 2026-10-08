// Shortest paths over the real OSM major-road network (for danfo rides).
import { mapData } from './mapData';

interface Graph {
  xs: Float64Array;
  zs: Float64Array;
  hs: Float32Array;
  adj: { to: number; w: number; len: number }[][];
  key: Map<string, number>;
}

let graph: Graph | null = null;
let graphNoOneway: Graph | null = null;

const COST: Record<number, number> = { 0: 0.75, 1: 0.8, 2: 0.88, 3: 1.0, 4: 1.15 };

function build(respectOneway: boolean): Graph {
  const key = new Map<string, number>();
  const xs: number[] = [], zs: number[] = [], hs: number[] = [];
  const adj: Graph['adj'] = [];
  const id = (x: number, z: number, h: number) => {
    const k = `${Math.round(x * 10)},${Math.round(z * 10)},${h > 0.5 ? 1 : 0}`;
    let i = key.get(k);
    if (i === undefined) {
      i = xs.length;
      key.set(k, i);
      xs.push(x); zs.push(z); hs.push(h);
      adj.push([]);
    }
    return i;
  };
  for (const r of mapData.majorRoads) {
    const n = r.pts.length / 2;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const h = r.h ? r.h[i] : 0;
      const cur = id(r.pts[i * 2], r.pts[i * 2 + 1], h);
      if (prev >= 0 && prev !== cur) {
        const len = Math.hypot(xs[cur] - xs[prev], zs[cur] - zs[prev]);
        const w = len * (COST[r.cls] ?? 1.2);
        adj[prev].push({ to: cur, w, len });
        if (!r.oneway || !respectOneway) adj[cur].push({ to: prev, w, len });
      }
      prev = cur;
    }
  }
  return { xs: Float64Array.from(xs), zs: Float64Array.from(zs), hs: Float32Array.from(hs), adj, key };
}

function nearest(g: Graph, x: number, z: number) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.xs.length; i++) {
    if (!g.adj[i].length || g.hs[i] > 0.5) continue;
    const d = (g.xs[i] - x) ** 2 + (g.zs[i] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function dijkstra(g: Graph, s: number, t: number): number[] | null {
  const N = g.xs.length;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  // binary heap of [d, node]
  const hd: number[] = [], hn: number[] = [];
  const push = (d: number, n: number) => {
    hd.push(d); hn.push(n);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      [hd[p], hd[i]] = [hd[i], hd[p]];
      [hn[p], hn[i]] = [hn[i], hn[p]];
      i = p;
    }
  };
  const pop = () => {
    const d = hd[0], n = hn[0];
    const ld = hd.pop()!, ln = hn.pop()!;
    if (hd.length) {
      hd[0] = ld; hn[0] = ln;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        [hd[m], hd[i]] = [hd[i], hd[m]];
        [hn[m], hn[i]] = [hn[i], hn[m]];
        i = m;
      }
    }
    return [d, n];
  };
  dist[s] = 0;
  push(0, s);
  // A* heuristic (straight line * min cost)
  const tx = g.xs[t], tz = g.zs[t];
  while (hd.length) {
    const [, u] = pop();
    if (u === t) break;
    const du = dist[u];
    for (const e of g.adj[u]) {
      const nd = du + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
        push(nd + Math.hypot(g.xs[e.to] - tx, g.zs[e.to] - tz) * 0.74, e.to);
      }
    }
  }
  if (!isFinite(dist[t])) return null;
  const path: number[] = [];
  for (let v = t; v !== -1; v = prev[v]) path.push(v);
  return path.reverse();
}

export interface Route {
  pts: Float32Array; // x,y,z triples
  length: number;
}

export function route(ax: number, az: number, bx: number, bz: number): Route | null {
  if (!graph) graph = build(true);
  let g = graph;
  let s = nearest(g, ax, az), t = nearest(g, bx, bz);
  let p = s >= 0 && t >= 0 ? dijkstra(g, s, t) : null;
  if (!p) {
    if (!graphNoOneway) graphNoOneway = build(false);
    g = graphNoOneway;
    s = nearest(g, ax, az);
    t = nearest(g, bx, bz);
    p = s >= 0 && t >= 0 ? dijkstra(g, s, t) : null;
  }
  if (!p) return null;
  const out: number[] = [ax, 0, az];
  for (const v of p) out.push(g.xs[v], g.hs[v], g.zs[v]);
  out.push(bx, 0, bz);
  let length = 0;
  for (let i = 3; i < out.length; i += 3) length += Math.hypot(out[i] - out[i - 3], out[i + 2] - out[i - 1]);
  return { pts: Float32Array.from(out), length };
}
